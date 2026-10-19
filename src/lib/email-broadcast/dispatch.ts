import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { LIMITS } from "@/config/limits";
import { monthStart } from "@/lib/queries/email-broadcasts";
import { composeEmail } from "./compose";
import { formatFrom } from "./render";
import { readMedia } from "@/lib/storage/blob";
import { platformResendKey } from "./platform";
import { isSenderAllowed } from "./sender-domain";
import { MAX_ATTACHMENTS_BYTES, attachmentContentType, checkAttachments, parseAttachments } from "./attachments";
import { sendBatch, sendOne, type ResendAttachment, type ResendEmail } from "./resend";
import { batchFailureAction, singleFailureAction } from "./retry-policy";
import { emailUnsubscribeOneClickUrl, emailUnsubscribePageUrl } from "./unsubscribe";
import type { MimeFile } from "./microsoft/mime";
import { markInterruptedUncertain, runMicrosoftBroadcast } from "./microsoft/deliver";

/**
 * Mass e-mail dispatcher. Runs as SYSTEM (raw Prisma, organizationId explicit
 * in every query). Recipients were materialized with a fixed batchNo, so each
 * batch has a stable Idempotency-Key and re-sending after a crash is deduped
 * by Resend (24h). A lease on `lastDispatchAt` keeps a single runner.
 */

export const BATCH_SIZE = 100;
const LEASE_MS = 90_000;
/** Budget for ALL mass e-mail together (~2 req/s in total, see activeSends):
 * the platform's Resend account (default limit 10 req/s per team) is shared
 * with login/invite/reset mail, which must keep its headroom. */
const PACE_MS = 500;
// Longest wait is 10 s; with an attachment call (up to 60 s) the gap between
// heartbeats is ~70 s of the 90 s LEASE_MS.
const MAX_PACE_FACTOR = 20;
const MAX_RETRY_AFTER_S = 10;
/** Per-job time budget in queue mode (the job re-enqueues itself after it). */
export const QUEUE_BUDGET_MS = 50_000;
/** Per-call timeout when the e-mail carries attachments (up to ~13.3 MB of base64). */
const ATTACHMENT_TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Batch = { id: string; email: string; name: string | null; companyName: string | null }[];
type Outcome = { kind: "ok" } | { kind: "pause"; message: string } | { kind: "budget" };

/** Start (or continue) a SENDING broadcast in the background. */
export async function kickEmailBroadcast(broadcastId: string): Promise<void> {
  if (isQueueConfigured()) {
    await enqueue("email-broadcast", { broadcastId });
    return;
  }
  // No queue (production today): run after the response, in this process.
  after(() =>
    runEmailBroadcast(broadcastId)
      .then(() => undefined)
      .catch((e) => console.error("[email] dispatch failed", e)),
  );
}

/** Thrown when another runner took over (our stamp no longer matches). */
class LeaseLost extends Error {}

/** Take the lease; returns the stamp we wrote (our ownership token) or null. */
async function takeLease(id: string, organizationId: string): Promise<Date | null> {
  const stamp = new Date();
  const res = await prisma.emailBroadcast.updateMany({
    where: {
      id,
      organizationId,
      status: "SENDING",
      OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: new Date(stamp.getTime() - LEASE_MS) } }],
    },
    data: { lastDispatchAt: stamp },
  });
  return res.count === 1 ? stamp : null;
}

type Counters = { rate: number; server: number; conflict: number };

/** Separate retry budgets per failure class: 429, 5xx/network, 409-concurrent. */
function failureClass(status: number): keyof Counters {
  return status === 429 ? "rate" : status === 409 ? "conflict" : "server";
}

function retryDelay(status: number, retryAfter: number | null, attempt: number): number | null {
  return status === 429 ? retryAfter : status === 409 ? 1 : 2 ** attempt;
}

/**
 * Send queued batches until done, paused, or the time budget ends (queue
 * mode). Returns `{ done: false }` only when the budget ran out — the caller
 * re-enqueues; the lease is released first so the next run can take it.
 * Every write that touches the lease is owner-checked on `lastDispatchAt`;
 * a runner that loses it stops at once.
 */
export async function runEmailBroadcast(
  broadcastId: string,
  opts: { budgetMs?: number } = {},
): Promise<{ done: boolean }> {
  const b = await prisma.emailBroadcast.findFirst({
    where: { id: broadcastId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      subject: true,
      html: true,
      fromName: true,
      fromEmail: true,
      replyTo: true,
      attachments: true,
      signatureHtml: true,
      signatureText: true,
      channel: true,
      senderAccountId: true,
    },
  });
  if (!b || b.status !== "SENDING") return { done: true };
  const org = b.organizationId;
  let stamp: Date | null = await takeLease(b.id, org);
  if (!stamp) return { done: true }; // another runner is alive
  // Only the lease owner sweeps: a recipient left SENDING was cut mid-call and is never resent.
  // Done before any early pause so leftover rows never show as "queued".
  if (b.channel === "MICROSOFT") await markInterruptedUncertain(b.id, org);

  /** Owner-checked heartbeat; throws LeaseLost when we are no longer the owner. */
  const beat = async () => {
    const next = new Date(Math.max(Date.now(), (stamp as Date).getTime() + 1));
    const res = await prisma.emailBroadcast.updateMany({
      where: { id: b.id, organizationId: org, status: "SENDING", lastDispatchAt: stamp },
      data: { lastDispatchAt: next },
    });
    if (res.count !== 1) throw new LeaseLost();
    stamp = next;
  };

  /** Renew the lease, then wait (capped) — the wait never outlives the lease. */
  const wait = async (seconds: number | null) => {
    await beat();
    await sleep(Math.min(seconds ?? 1, MAX_RETRY_AFTER_S) * 1000);
  };

  /** Sends running right now on the platform account (any org): an aggregate
   * count only, nothing org-specific is read. Each waits N × PACE_MS so the
   * total stays ~2 req/s. */
  const activeSends = () =>
    prisma.emailBroadcast.count({
      where: { status: "SENDING", channel: "PLATFORM", lastDispatchAt: { gte: new Date(Date.now() - LEASE_MS) } },
    });
  let paceMs = PACE_MS;

  const pause = (
    reason:
      | "no_connection"
      | "quota"
      | "provider_error"
      | "domain_not_allowed"
      | "from_missing"
      | "attachment_unavailable"
      | "attachment_invalid"
      | "daily_limit"
      | "reconnect"
      | "no_sender_account"
      | "account_blocked",
    message: string | null,
  ) =>
    prisma.emailBroadcast.updateMany({
      where: { id: b.id, organizationId: org, status: "SENDING", lastDispatchAt: stamp },
      data: { status: "PAUSED", pausedReason: reason, lastError: message?.slice(0, 500) ?? null, lastDispatchAt: null },
    });

  /** Re-checked before every batch: a domain removed with email:dominio stops the send. */
  const senderStillAllowed = async () => {
    const rows = await prisma.emailSenderDomain.findMany({
      where: { organizationId: org },
      select: { domain: true },
    });
    return Boolean(b.fromEmail) && isSenderAllowed(b.fromEmail as string, rows.map((r) => r.domain));
  };

  try {
    const microsoft = b.channel === "MICROSOFT";
    const apiKey = platformResendKey();
    if (!microsoft && !apiKey) {
      await pause("no_connection", null);
      return { done: true };
    }
    if (!b.fromEmail) {
      await pause("from_missing", null);
      return { done: true };
    }
    const orgRow = await prisma.organization.findFirst({ where: { id: org }, select: { name: true } });
    const orgName = orgRow?.name ?? "";
    const from = formatFrom(b.fromName, b.fromEmail);

    // Attachments are read once per run, before any e-mail: a send never goes
    // out without its files (spec 2026-10-09 §8). Raw bytes serve both
    // channels; Resend gets base64.
    const attachments = parseAttachments(b.attachments);
    if (!attachments || checkAttachments(org, attachments)) {
      await pause("attachment_invalid", null);
      return { done: true };
    }
    const raw: MimeFile[] = [];
    let bytes = 0;
    for (const a of attachments) {
      let data: Buffer;
      try {
        data = await readMedia(a.key);
      } catch (e) {
        console.error("[email] attachment read failed", a.key, e);
        await pause("attachment_unavailable", a.filename);
        return { done: true };
      }
      // The sizes saved with the draft come from the client; the real bytes
      // decide, checked before encoding so a forged list never piles up in memory.
      bytes += data.byteLength;
      if (bytes > MAX_ATTACHMENTS_BYTES || data.byteLength !== a.size) {
        await pause("attachment_invalid", a.filename);
        return { done: true };
      }
      raw.push({ filename: a.filename, contentType: attachmentContentType(a.filename) ?? "application/octet-stream", data });
      await beat();
    }
    // After the (possibly slow) file reads, so they don't eat the queue budget.
    const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;

    // The signature frozen when the send started; email_signatures is never read here.
    const signature = b.signatureHtml ? { html: b.signatureHtml, text: b.signatureText ?? "" } : null;
    const composeFor = (r: Batch[number]) => {
      const composed = composeEmail({
        subject: b.subject,
        bodyHtml: b.html,
        vars: { nome: r.name ?? "", empresa: r.companyName ?? "" },
        orgName,
        unsubscribeUrl: emailUnsubscribePageUrl(r.id),
        signature,
      });
      return {
        subject: composed.subject,
        html: composed.html,
        text: composed.text,
        headers: {
          "List-Unsubscribe": `<${emailUnsubscribeOneClickUrl(r.id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    };

    if (microsoft) {
      const outcome = await runMicrosoftBroadcast({
        broadcastId: b.id,
        organizationId: org,
        fromName: b.fromName,
        fromEmail: b.fromEmail,
        replyTo: b.replyTo,
        deadline,
        files: raw,
        compose: composeFor,
        beat,
        wait,
        pause,
        finish: async () => {
          await prisma.emailBroadcast.updateMany({
            where: { id: b.id, organizationId: org, status: "SENDING", lastDispatchAt: stamp },
            data: { status: "DONE", finishedAt: new Date(), lastDispatchAt: null },
          });
        },
        activeSince: () => new Date(Date.now() - LEASE_MS),
      });
      if (outcome.done) return outcome;
    } else {
      const resendKey = apiKey as string;
      const files: ResendAttachment[] | null = raw.length
        ? raw.map((f) => ({ filename: f.filename, content: f.data.toString("base64"), content_type: f.contentType }))
        : null;
      const toEmail = (r: Batch[number]): ResendEmail => {
        const c = composeFor(r);
        return {
          from,
          to: [r.email],
          subject: c.subject,
          html: c.html,
          text: c.text,
          ...(b.replyTo ? { reply_to: b.replyTo } : {}),
          headers: c.headers,
          ...(files ? { attachments: files } : {}),
        };
      };

      const markSent = (rows: { id: string; providerId: string | null }[]) =>
        prisma.$transaction(
          rows.map((row) =>
            prisma.emailBroadcastRecipient.updateMany({
              where: { id: row.id, organizationId: org, status: "QUEUED" },
              data: { status: "SENT", providerMessageId: row.providerId, sentAt: new Date(), error: null },
            }),
          ),
        );

      /** One call per recipient: the fallback when a batch as a whole is refused,
       * and the main path for sends with attachments (/emails/batch takes none). */
      const oneByOne = async (batch: Batch, batchNo: number): Promise<Outcome> => {
        let streakStatus = -1;
        let streak = 0;
        for (const r of batch) {
          // Stop between recipients when the run's budget is over (queue mode);
          // the rest of the batch stays QUEUED for the next run.
          if (Date.now() >= deadline) return { kind: "budget" };
          const key = `eb-${b.id}-${batchNo}-${r.id}`;
          const counters: Counters = { rate: 0, server: 0, conflict: 0 };
          for (;;) {
            const res = await sendOne(resendKey, toEmail(r), key, files ? ATTACHMENT_TIMEOUT_MS : undefined);
            if (res.ok) {
              await markSent([{ id: r.id, providerId: res.data.id ?? null }]);
              streak = 0;
              streakStatus = -1;
              break;
            }
            const cls = failureClass(res.status);
            const attempt = counters[cls];
            const action = singleFailureAction(res.status, res.name, attempt);
            if (action === "retry_same_key") {
              counters[cls]++;
              await wait(retryDelay(res.status, res.retryAfter, attempt));
              continue;
            }
            if (action === "pause") return { kind: "pause", message: res.message };
            // fail_recipient
            await prisma.emailBroadcastRecipient.updateMany({
              where: { id: r.id, organizationId: org, status: "QUEUED" },
              data: { status: "FAILED", error: res.message.slice(0, 500) },
            });
            streak = res.status === streakStatus ? streak + 1 : 1;
            streakStatus = res.status;
            if (streak >= 5) {
              return { kind: "pause", message: `5 consecutive failures (${res.status}): ${res.message}` };
            }
            break;
          }
          await beat();
          await sleep(paceMs);
        }
        return { kind: "ok" };
      };

      const deliver = async (batch: Batch, batchNo: number): Promise<Outcome> => {
        const emails = batch.map(toEmail);
        const counters: Counters = { rate: 0, server: 0, conflict: 0 };
        for (;;) {
          const res = await sendBatch(resendKey, emails, `eb-${b.id}-${batchNo}`);
          if (res.ok) {
            const ids = res.data.data ?? [];
            await markSent(batch.map((r, i) => ({ id: r.id, providerId: ids[i]?.id ?? null })));
            return { kind: "ok" };
          }
          const cls = failureClass(res.status);
          const attempt = counters[cls];
          const action = batchFailureAction(res.status, res.name, attempt);
          if (action === "retry_same_key") {
            counters[cls]++;
            await wait(retryDelay(res.status, res.retryAfter, attempt));
            continue;
          }
          if (action === "per_recipient") return oneByOne(batch, batchNo);
          return { kind: "pause", message: res.message };
        }
      };

      while (Date.now() < deadline) {
        const current = await prisma.emailBroadcast.findFirst({
          where: { id: b.id, organizationId: org },
          select: { status: true },
        });
        if (current?.status !== "SENDING") return { done: true };
        if (!(await senderStillAllowed())) {
          await pause("domain_not_allowed", null);
          return { done: true };
        }
        paceMs = PACE_MS * Math.min(Math.max(1, await activeSends()), MAX_PACE_FACTOR);

        const next = await prisma.emailBroadcastRecipient.findFirst({
          where: { broadcastId: b.id, organizationId: org, status: "QUEUED" },
          orderBy: { batchNo: "asc" },
          select: { batchNo: true },
        });
        if (!next) {
          await prisma.emailBroadcast.updateMany({
            where: { id: b.id, organizationId: org, status: "SENDING", lastDispatchAt: stamp },
            data: { status: "DONE", finishedAt: new Date(), lastDispatchAt: null },
          });
          return { done: true };
        }

        const batch: Batch = await prisma.emailBroadcastRecipient.findMany({
          where: { broadcastId: b.id, organizationId: org, status: "QUEUED", batchNo: next.batchNo },
          orderBy: { email: "asc" },
          select: { id: true, email: true, name: true, companyName: true },
        });

        const sent = await prisma.emailBroadcastRecipient.count({
          where: { organizationId: org, sentAt: { gte: monthStart() }, broadcast: { channel: "PLATFORM" } },
        });
        if (sent + batch.length > LIMITS.emailBroadcastQuotaPerMonth) {
          await pause("quota", null);
          return { done: true };
        }

        // /emails/batch doesn't take attachments: with files, one call per recipient.
        const outcome = files ? await oneByOne(batch, next.batchNo) : await deliver(batch, next.batchNo);
        if (outcome.kind === "pause") {
          await pause("provider_error", outcome.message);
          return { done: true };
        }
        if (outcome.kind === "budget") break;

        await beat();
        await sleep(paceMs);
      }
    }

    // Budget over (queue mode): release the lease so the re-enqueued job can take it.
    await prisma.emailBroadcast.updateMany({
      where: { id: b.id, organizationId: org, status: "SENDING", lastDispatchAt: stamp },
      data: { lastDispatchAt: null },
    });
    return { done: false };
  } catch (e) {
    if (e instanceof LeaseLost) return { done: true }; // someone else owns it now
    console.error("[email] dispatcher crashed", e);
    try {
      await pause("provider_error", e instanceof Error ? e.message : "Unexpected error");
    } catch (e2) {
      console.error("[email] could not pause after crash", e2);
    }
    return { done: true };
  }
}
