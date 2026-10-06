import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { LIMITS } from "@/config/limits";
import { monthStart } from "@/lib/queries/email-broadcasts";
import { composeEmail } from "./compose";
import { formatFrom } from "./render";
import { getResendConnection } from "./connection";
import { sendBatch, sendOne, type ResendEmail } from "./resend";
import { emailUnsubscribeOneClickUrl, emailUnsubscribePageUrl } from "./unsubscribe";

/**
 * Mass e-mail dispatcher. Runs as SYSTEM (raw Prisma, organizationId explicit
 * in every query). Recipients were materialized with a fixed batchNo, so each
 * batch has a stable Idempotency-Key and re-sending after a crash is deduped
 * by Resend (24h). A lease on `lastDispatchAt` keeps a single runner.
 */

export const BATCH_SIZE = 100;
const LEASE_MS = 90_000;
const PACE_MS = 150;
/** Per-job time budget in queue mode (the job re-enqueues itself after it). */
export const QUEUE_BUDGET_MS = 50_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Batch = { id: string; email: string; name: string | null; companyName: string | null }[];
type Outcome = { kind: "ok" } | { kind: "pause"; message: string };

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

async function takeLease(id: string, organizationId: string): Promise<boolean> {
  const res = await prisma.emailBroadcast.updateMany({
    where: {
      id,
      organizationId,
      status: "SENDING",
      OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: new Date(Date.now() - LEASE_MS) } }],
    },
    data: { lastDispatchAt: new Date() },
  });
  return res.count === 1;
}

/**
 * Send queued batches until done, paused, or the time budget ends (queue
 * mode). Returns `{ done: false }` only when the budget ran out — the caller
 * re-enqueues; the lease is released first so the next run can take it.
 */
export async function runEmailBroadcast(
  broadcastId: string,
  opts: { budgetMs?: number } = {},
): Promise<{ done: boolean }> {
  const b = await prisma.emailBroadcast.findFirst({
    where: { id: broadcastId },
    select: { id: true, organizationId: true, status: true, subject: true, html: true, fromName: true, replyTo: true },
  });
  if (!b || b.status !== "SENDING") return { done: true };
  const org = b.organizationId;
  if (!(await takeLease(b.id, org))) return { done: true }; // another runner is alive

  const pause = (reason: "no_connection" | "quota" | "provider_error", message: string | null) =>
    prisma.emailBroadcast.updateMany({
      where: { id: b.id, organizationId: org, status: "SENDING" },
      data: { status: "PAUSED", pausedReason: reason, lastError: message?.slice(0, 500) ?? null, lastDispatchAt: null },
    });

  const conn = await getResendConnection(org);
  if (!conn) {
    await pause("no_connection", null);
    return { done: true };
  }
  const orgRow = await prisma.organization.findFirst({ where: { id: org }, select: { name: true } });
  const orgName = orgRow?.name ?? "";
  const from = formatFrom(b.fromName, conn.fromEmail);
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;

  const toEmail = (r: Batch[number]): ResendEmail => {
    const composed = composeEmail({
      subject: b.subject,
      bodyHtml: b.html,
      vars: { nome: r.name ?? "", empresa: r.companyName ?? "" },
      orgName,
      unsubscribeUrl: emailUnsubscribePageUrl(r.id),
    });
    return {
      from,
      to: [r.email],
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      ...(b.replyTo ? { reply_to: b.replyTo } : {}),
      headers: {
        "List-Unsubscribe": `<${emailUnsubscribeOneClickUrl(r.id)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
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

  /** Fallback when the batch as a whole is refused: one call per recipient. */
  const oneByOne = async (batch: Batch, batchNo: number): Promise<Outcome> => {
    for (const r of batch) {
      let res = await sendOne(conn.apiKey, toEmail(r), `eb-${b.id}-${batchNo}-${r.id}`);
      for (let tries = 0; !res.ok && res.status === 429 && tries < 5; tries++) {
        await sleep((res.retryAfter ?? 1) * 1000);
        res = await sendOne(conn.apiKey, toEmail(r), `eb-${b.id}-${batchNo}-${r.id}`);
      }
      if (res.ok) {
        await markSent([{ id: r.id, providerId: res.data.id ?? null }]);
      } else if (res.status === 401 || res.status === 403 || res.status === 0 || res.status >= 500) {
        return { kind: "pause", message: res.message };
      } else {
        await prisma.emailBroadcastRecipient.updateMany({
          where: { id: r.id, organizationId: org, status: "QUEUED" },
          data: { status: "FAILED", error: res.message.slice(0, 500) },
        });
      }
      await sleep(PACE_MS);
    }
    return { kind: "ok" };
  };

  const deliver = async (batch: Batch, batchNo: number): Promise<Outcome> => {
    const emails = batch.map(toEmail);
    for (let attempt = 0; ; attempt++) {
      const res = await sendBatch(conn.apiKey, emails, `eb-${b.id}-${batchNo}`);
      if (res.ok) {
        const ids = res.data.data ?? [];
        await markSent(batch.map((r, i) => ({ id: r.id, providerId: ids[i]?.id ?? null })));
        return { kind: "ok" };
      }
      if (res.status === 429 && attempt < 5) {
        await sleep((res.retryAfter ?? 1) * 1000);
        continue;
      }
      if ((res.status === 0 || res.status >= 500) && attempt < 3) {
        await sleep(1000 * 2 ** attempt); // same key: safe to retry
        continue;
      }
      // 400/409/422: a bad address or a changed batch — go one by one.
      if (res.status === 400 || res.status === 409 || res.status === 422) return oneByOne(batch, batchNo);
      return { kind: "pause", message: res.message };
    }
  };

  while (Date.now() < deadline) {
    const current = await prisma.emailBroadcast.findFirst({
      where: { id: b.id, organizationId: org },
      select: { status: true },
    });
    if (current?.status !== "SENDING") return { done: true };

    const next = await prisma.emailBroadcastRecipient.findFirst({
      where: { broadcastId: b.id, organizationId: org, status: "QUEUED" },
      orderBy: { batchNo: "asc" },
      select: { batchNo: true },
    });
    if (!next) {
      await prisma.emailBroadcast.updateMany({
        where: { id: b.id, organizationId: org, status: "SENDING" },
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
      where: { organizationId: org, sentAt: { gte: monthStart() } },
    });
    if (sent + batch.length > LIMITS.emailBroadcastQuotaPerMonth) {
      await pause("quota", null);
      return { done: true };
    }

    const outcome = await deliver(batch, next.batchNo);
    if (outcome.kind === "pause") {
      await pause("provider_error", outcome.message);
      return { done: true };
    }

    await prisma.emailBroadcast.updateMany({
      where: { id: b.id, organizationId: org },
      data: { lastDispatchAt: new Date() }, // heartbeat
    });
    await sleep(PACE_MS);
  }

  // Budget over (queue mode): release the lease so the re-enqueued job can take it.
  await prisma.emailBroadcast.updateMany({
    where: { id: b.id, organizationId: org, status: "SENDING" },
    data: { lastDispatchAt: null },
  });
  return { done: false };
}
