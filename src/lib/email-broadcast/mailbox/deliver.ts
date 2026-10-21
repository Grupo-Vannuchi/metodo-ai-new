import "server-only";
import { prisma } from "@/lib/prisma";
import { INTERRUPTED_ERROR } from "../failure-reason";
import type { MimeFile, MimeMail } from "../microsoft/mime";
import {
  mailboxPaceWaitMs,
  remainingToday,
  sentLast24hWhere,
  sentLastHourWhere,
  waitChunksMs,
  type MailboxFailureAction,
  type MailboxSendFailure,
  type MailboxSendOutcome,
} from "./core";
import { markNeedsReconnect } from "./token";

export type MailboxPauseReason = "daily_limit" | "reconnect" | "no_sender_account" | "account_blocked" | "provider_error";
type Recipient = { id: string; email: string; name: string | null; companyName: string | null };

/** What the platform dispatcher hands over: identity, lease helpers and the per-recipient content. */
export type MailboxRun = {
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
  pause: (reason: MailboxPauseReason, message: string | null) => Promise<unknown>;
  finish: () => Promise<void>;
  /** Lease cutoff: sends with a heartbeat after it are running right now. */
  activeSince: () => Date;
};

/** The connected account as the loop re-reads it before every e-mail: an edit of its limits counts from the next one. */
export type MailboxAccount = {
  id: string;
  status: "ACTIVE" | "NEEDS_RECONNECT";
  accountKind: string;
  dailyLimit: number | null;
  hourlyLimit: number | null;
};

/** What `send` needs to reach the provider (an OAuth token, the SMTP settings...), or why there is none. */
export type MailboxAccess<A> =
  | { ok: true; access: A }
  | { ok: false; reason: "reconnect" | "temporary"; message: string };

/**
 * The provider-specific points of the send loop (Microsoft Graph, Gmail or an
 * SMTP server): everything else, the reservation and the settling included,
 * is shared, so every channel keeps the same "nobody receives it twice"
 * guarantees. `A` is what `send` gets from `access`.
 */
export type MailboxAdapter<A> = {
  channel: "MICROSOFT" | "GOOGLE" | "SMTP";
  /** What `send` needs; `force` renews it (after a 401). "reconnect" pauses the send, "temporary" waits and tries again. */
  access(organizationId: string, accountId: string, opts?: { force?: boolean }): Promise<MailboxAccess<A>>;
  /** Sends per 24 h for this account: reaching it pauses the send. */
  dailyLimit(account: MailboxAccount): number;
  /** Sends per 60 min for this account, or null when the provider has none: reaching it waits, never pauses. */
  hourlyLimit(account: MailboxAccount): number | null;
  /** Milliseconds between two e-mails of this account, before stretching by the sends of it running at once. */
  paceMs(account: MailboxAccount): number;
  /** One e-mail out of the connected mailbox. Never throws. */
  send(access: A, mail: Omit<MimeMail, "attachments">, files: MimeFile[]): Promise<MailboxSendOutcome>;
  /** What to do with a failed call; `attempt` counts earlier retries of this same e-mail. */
  failureAction(failure: MailboxSendFailure, attempt: number): MailboxFailureAction;
  /** How a failure is stored on the recipient. */
  recipientError(code: string | null, message: string): string;
};

/**
 * A pause between e-mails up to this long is slept in one go; a longer one in
 * pieces of this size, each renewing the 90 s lease first (run.wait).
 */
const PACE_CHUNK_MS = 10_000;
/** Seconds a send waits, renewing the lease, before checking a full hourly limit again. */
const HOURLY_RECHECK_S = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Turns the recipients a dead run left SENDING into UNCERTAIN (never resent).
 * Call it only from the lease owner, right after the lease is taken.
 */
export async function markInterruptedUncertain(broadcastId: string, organizationId: string): Promise<void> {
  await prisma.emailBroadcastRecipient.updateMany({
    where: { broadcastId, organizationId, status: "SENDING" },
    data: { status: "UNCERTAIN", error: INTERRUPTED_ERROR },
  });
}

/**
 * "Send through the company's own mailbox" channels of the mass e-mail
 * dispatcher (Microsoft spec §6, Google spec 2026-10-19, SMTP spec 2026-10-21
 * §5.1): one loop, with the provider's points in `adapter`. One recipient at a
 * time: re-read the account (it must belong to the adapter's provider), check
 * its daily limit (reached: pause) and its hourly limit, if it has one
 * (reached: wait, never pause), reserve the recipient (QUEUED → SENDING,
 * sentAt stamped), hand it to the provider, then SENT / FAILED / UNCERTAIN,
 * then wait the account's pace. A recipient still SENDING from a dead run was
 * cut mid-call (markInterruptedUncertain, called by the dispatcher): it is
 * never resent. No wait goes 10 s without renewing the lease. System context:
 * organizationId explicit everywhere.
 */
export async function runMailboxBroadcast<A>(run: MailboxRun, adapter: MailboxAdapter<A>): Promise<{ done: boolean }> {
  const org = run.organizationId;

  /** Honours Retry-After up to 60 s, in chunks of at most 10 s (each run.wait renews the lease). */
  const waitUpTo = async (seconds: number) => {
    let left = Math.min(seconds, 60);
    while (left > 0) {
      const chunk = Math.min(left, 10);
      await run.wait(chunk);
      left -= chunk;
    }
  };

  let streak = 0;
  let accessFailures = 0;
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

    const account: MailboxAccount | null = current.senderAccountId
      ? await prisma.emailSenderAccount.findFirst({
          where: { id: current.senderAccountId, organizationId: org, provider: adapter.channel },
          select: { id: true, status: true, accountKind: true, dailyLimit: true, hourlyLimit: true },
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
    if (remainingToday(adapter.dailyLimit(account), used) <= 0) {
      await run.pause("daily_limit", null);
      return { done: true };
    }

    // The hourly limit never pauses: the send waits, renewing the lease,
    // until the hour's oldest e-mail drops out of the count.
    const hourly = adapter.hourlyLimit(account);
    if (hourly !== null) {
      const lastHour = await prisma.emailBroadcastRecipient.count({
        where: { organizationId: org, ...sentLastHourWhere(account.id, new Date()) },
      });
      if (lastHour >= hourly) {
        await run.wait(HOURLY_RECHECK_S);
        continue;
      }
    }

    let access = await adapter.access(org, account.id);
    if (!access.ok) {
      if (access.reason === "reconnect") {
        await run.pause("reconnect", access.message);
        return { done: true };
      }
      accessFailures++;
      if (accessFailures >= 3) {
        await run.pause("provider_error", access.message);
        return { done: true };
      }
      await run.wait(2 ** accessFailures);
      continue;
    }
    accessFailures = 0;

    // Owner-checked heartbeat, then the reservation: from here on this
    // recipient is never sent twice.
    await run.beat();
    const claim = (db: Pick<typeof prisma, "emailBroadcastRecipient">) =>
      db.emailBroadcastRecipient.updateMany({
        where: { id: r.id, organizationId: org, status: "QUEUED" },
        data: { status: "SENDING", sentAt: new Date(), error: null },
      });
    // With an hourly limit, the hour's count and the reservation run under one
    // lock per account, so two sends of the same account (each checked above
    // with one e-mail to spare) never both take the hour's last one.
    const claimed =
      hourly === null
        ? await claim(prisma)
        : await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`email_sender_hour:${org}:${account.id}`}))`;
            const lastHour = await tx.emailBroadcastRecipient.count({
              where: { organizationId: org, ...sentLastHourWhere(account.id, new Date()) },
            });
            return lastHour >= hourly ? null : await claim(tx);
          });
    if (!claimed) {
      await run.wait(HOURLY_RECHECK_S);
      continue;
    }
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
      const res = await adapter.send(access.access, mail, run.files);
      if (res.ok) {
        await settle({ status: "SENT", error: null });
        streak = 0;
        break;
      }
      const action = adapter.failureAction(res, attempt);
      if ((action === "refresh" || res.status === 401) && !refreshed) {
        refreshed = true;
        const again = await adapter.access(org, account.id, { force: true });
        if (again.ok) {
          access = again;
          attempt++;
          continue;
        }
        await release();
        await run.pause(again.reason === "temporary" ? "provider_error" : "reconnect", again.message);
        return { done: true };
      }
      if (action === "retry") {
        attempt++;
        await waitUpTo(res.retryAfter ?? 2 ** attempt);
        continue;
      }
      if (action === "uncertain") {
        await settle({ status: "UNCERTAIN", error: INTERRUPTED_ERROR });
        break;
      }
      if (action === "recipient") {
        await settle({ status: "FAILED", error: adapter.recipientError(res.code, res.message), sentAt: null });
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
        channel: adapter.channel,
        senderAccountId: account.id,
        lastDispatchAt: { gte: run.activeSince() },
      },
    });
    const pace = mailboxPaceWaitMs(adapter.paceMs(account), running);
    if (pace <= PACE_CHUNK_MS) await sleep(pace);
    else {
      // A long pause (an SMTP hourly limit, or many sends of one account) in
      // pieces that renew the lease; the run's budget still ends it midway.
      for (const chunk of waitChunksMs(pace, PACE_CHUNK_MS)) {
        if (Date.now() >= run.deadline) break;
        await run.wait(chunk / 1000);
      }
    }
  }
  return { done: false };
}
