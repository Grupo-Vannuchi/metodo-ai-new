import "server-only";
import { prisma } from "@/lib/prisma";
import { INTERRUPTED_ERROR, microsoftRecipientError } from "../failure-reason";
import { MICROSOFT_PACE_MS, graphFailureAction, microsoftDailyLimit, remainingToday, sentLast24hWhere } from "./core";
import type { MimeFile, MimeMail } from "./mime";
import { sendMicrosoftMail } from "./send";
import { getMicrosoftAccessToken, markNeedsReconnect } from "./token";

export type MicrosoftPauseReason = "daily_limit" | "reconnect" | "no_sender_account" | "account_blocked" | "provider_error";
type Recipient = { id: string; email: string; name: string | null; companyName: string | null };

/** What the platform dispatcher hands over: identity, lease helpers and the per-recipient content. */
export type MicrosoftRun = {
  broadcastId: string;
  organizationId: string;
  fromName: string | null;
  fromEmail: string;
  replyTo: string | null;
  deadline: number;
  files: MimeFile[];
  compose: (r: Recipient) => Pick<MimeMail, "subject" | "html" | "text" | "headers">;
  beat: () => Promise<void>;
  wait: (seconds: number | null) => Promise<void>;
  pause: (reason: MicrosoftPauseReason, message: string | null) => Promise<unknown>;
  finish: () => Promise<void>;
  /** Lease cutoff: sends with a heartbeat after it are running right now. */
  activeSince: () => Date;
};

const MAX_PACE_FACTOR = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Microsoft channel of the mass e-mail dispatcher (spec §6). One recipient at
 * a time: re-read the account, check today's estimate, reserve the recipient
 * (QUEUED → SENDING, sentAt stamped), hand it to Graph, then SENT / FAILED /
 * UNCERTAIN. A recipient still SENDING when a run starts was cut mid-call:
 * it becomes UNCERTAIN and is never resent. System context: organizationId
 * explicit everywhere.
 */
export async function runMicrosoftBroadcast(run: MicrosoftRun): Promise<{ done: boolean }> {
  const org = run.organizationId;
  await prisma.emailBroadcastRecipient.updateMany({
    where: { broadcastId: run.broadcastId, organizationId: org, status: "SENDING" },
    data: { status: "UNCERTAIN", error: INTERRUPTED_ERROR },
  });

  let streak = 0;
  let tokenFailures = 0;
  while (Date.now() < run.deadline) {
    const current = await prisma.emailBroadcast.findFirst({
      where: { id: run.broadcastId, organizationId: org },
      select: { status: true, senderAccountId: true },
    });
    if (current?.status !== "SENDING") return { done: true };
    const r = await prisma.emailBroadcastRecipient.findFirst({
      where: { broadcastId: run.broadcastId, organizationId: org, status: "QUEUED" },
      orderBy: [{ batchNo: "asc" }, { email: "asc" }],
      select: { id: true, email: true, name: true, companyName: true },
    });
    if (!r) {
      await run.finish();
      return { done: true };
    }

    const account = current.senderAccountId
      ? await prisma.emailSenderAccount.findFirst({
          where: { id: current.senderAccountId, organizationId: org },
          select: { id: true, status: true, accountKind: true },
        })
      : null;
    if (!account) {
      await run.pause("no_sender_account", null);
      return { done: true };
    }
    if (account.status !== "ACTIVE") {
      await run.pause("reconnect", null);
      return { done: true };
    }

    const used = await prisma.emailBroadcastRecipient.count({
      where: { organizationId: org, ...sentLast24hWhere(account.id, new Date()) },
    });
    if (remainingToday(microsoftDailyLimit(account.accountKind), used) <= 0) {
      await run.pause("daily_limit", null);
      return { done: true };
    }

    let token = await getMicrosoftAccessToken(org, account.id);
    if (!token.ok) {
      if (token.reason === "reconnect") {
        await run.pause("reconnect", token.message);
        return { done: true };
      }
      tokenFailures++;
      if (tokenFailures >= 3) {
        await run.pause("provider_error", token.message);
        return { done: true };
      }
      await run.wait(2 ** tokenFailures);
      continue;
    }
    tokenFailures = 0;

    // Owner-checked heartbeat, then the reservation: from here on this
    // recipient is never sent twice.
    await run.beat();
    const claimed = await prisma.emailBroadcastRecipient.updateMany({
      where: { id: r.id, organizationId: org, status: "QUEUED" },
      data: { status: "SENDING", sentAt: new Date(), error: null },
    });
    if (claimed.count !== 1) continue;
    const release = () =>
      prisma.emailBroadcastRecipient.updateMany({
        where: { id: r.id, organizationId: org, status: "SENDING" },
        data: { status: "QUEUED", sentAt: null },
      });
    const settle = (data: { status: "SENT" | "FAILED" | "UNCERTAIN"; error: string | null; sentAt?: null }) =>
      prisma.emailBroadcastRecipient.updateMany({
        where: { id: r.id, organizationId: org, status: "SENDING" },
        data,
      });

    const mail = {
      from: { name: run.fromName, address: run.fromEmail },
      to: r.email,
      replyTo: run.replyTo,
      ...run.compose(r),
    };
    let attempt = 0;
    let refreshed = false;
    for (;;) {
      const res = await sendMicrosoftMail(token.accessToken, mail, run.files);
      if (res.ok) {
        await settle({ status: "SENT", error: null });
        streak = 0;
        break;
      }
      const action = graphFailureAction(res.status, res.code, attempt, res.stage);
      if ((action === "refresh" || res.status === 401) && !refreshed) {
        refreshed = true;
        const again = await getMicrosoftAccessToken(org, account.id, { force: true });
        if (again.ok) {
          token = again;
          attempt++;
          continue;
        }
        await release();
        await run.pause("reconnect", again.message);
        return { done: true };
      }
      if (action === "retry") {
        attempt++;
        await run.wait(res.retryAfter ?? 2 ** attempt);
        continue;
      }
      if (action === "uncertain") {
        await settle({ status: "UNCERTAIN", error: INTERRUPTED_ERROR });
        break;
      }
      if (action === "recipient") {
        await settle({ status: "FAILED", error: microsoftRecipientError(res.code, res.message), sentAt: null });
        streak++;
        if (streak >= 3) {
          await run.pause("provider_error", `3 consecutive failures (${res.status}): ${res.message}`);
          return { done: true };
        }
        break;
      }
      await release();
      if (action === "daily_limit") await run.pause("daily_limit", res.message);
      else if (action === "blocked") await run.pause("account_blocked", res.message);
      else if (action === "reconnect" || action === "refresh") {
        await markNeedsReconnect(org, account.id, res.message);
        await run.pause("reconnect", res.message);
      } else await run.pause("provider_error", res.message);
      return { done: true };
    }

    await run.beat();
    const running = await prisma.emailBroadcast.count({
      where: {
        organizationId: org,
        status: "SENDING",
        channel: "MICROSOFT",
        senderAccountId: account.id,
        lastDispatchAt: { gte: run.activeSince() },
      },
    });
    await sleep(MICROSOFT_PACE_MS * Math.min(Math.max(1, running), MAX_PACE_FACTOR));
  }
  return { done: false };
}
