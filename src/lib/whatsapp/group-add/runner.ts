import "server-only";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueue, isQueueConfigured } from "@/lib/queue";
import { decryptCredentials } from "@/lib/integrations/crypto";
import { resolveEvoCreds } from "@/lib/integrations/evolution-creds";
import {
  addGroupParticipant,
  checkOnWhatsapp,
  connectionState,
  fetchGroupInviteUrl,
  fetchGroupSummary,
  fetchOwnerJid,
  sendPlainText,
  type EvoCreds,
  type EvoState,
} from "@/lib/integrations/evolution-client";
import { isAdminOf } from "@/lib/integrations/evolution-groups";
import { saoPauloDayStart } from "@/lib/tasks/board-core";
import {
  CAP_COUNTED,
  GROUP_ADD_DAILY_CAP,
  capResumeAt,
  isInsideWindow,
  linkedNumber,
  nextAttemptAt,
  nextWindowStart,
  outcomeFromCode,
  phoneMatchKey,
  pickPauseSeconds,
  renderInvite,
  UNCERTAIN_HTTP_STATUSES,
  type LinkedNumber,
} from "./core";

/**
 * The runner of "Adicionar a grupo do WhatsApp" (spec 2026-10-28). Runs as SYSTEM (raw Prisma, organizationId explicit in
 * every query, taken from the run). One run has one runner at a time, held by a lease on `lastDispatchAt` as in the mass
 * e-mail (email-broadcast/dispatch.ts): every write that touches the run is owner-checked on the stamp, and a runner that
 * loses it stops at once. One person is handled at a time: reserved (PROCESSING) before the first call to Evolution, so a
 * person left PROCESSING by a crash is FAILED / interrupted and never redone. One run is RUNNING per number (`senderKey`),
 * in any organization; the rest wait QUEUED, and the number's cap of a day is counted over all of them (counts and ids
 * only). Logs carry run ids and error names, never a number or the invite text.
 */

/** How long an unreachable Evolution is left alone before the run asks again. */
const UNAVAILABLE_WAIT_MS = 5 * 60_000;
/** connectionState has no timeout of its own, and the lease would run out under a call that never answers. */
const STATE_TIMEOUT_MS = 15_000;
/**
 * The note on a run paused as not_admin because the group could not be read: the cron and a poke take it back once they can.
 * The tracking screen reads it too, to say so instead of "your number is no longer admin".
 */
export const GROUP_UNREADABLE = "group_unreadable";

export type GroupAddRuntime = {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  /** How long a stamp on `lastDispatchAt` keeps the run to its runner. */
  leaseMs: number;
  /** The longest sleep without renewing the lease. */
  chunkMs: number;
  /** Runs a task in the background of the process: after() here; the check replaces it with a capture. */
  schedule: (task: () => Promise<void>) => void;
};

/**
 * @internal test seam: scripts/check-whatsapp-group-add-e2e.ts moves the clock, makes
 * sleeping instant and takes over the scheduler. Everything the runner stamps, waits for or
 * compares with the time comes from here.
 */
export const groupAddRuntime: GroupAddRuntime = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
  leaseMs: 90_000,
  chunkMs: 10_000,
  schedule: (task) => {
    after(() => task().catch((e) => console.error("[group-add] background run failed", errorTag(e))));
  },
};

/** What an error is called in a log or in `lastError`: its name and code, never its message (it may hold a number or the text). */
export function errorTag(e: unknown): string {
  if (!(e instanceof Error)) return "UnknownError";
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? `${e.name} ${code}` : e.name;
}

/** Thrown when another runner took over (our stamp no longer matches). */
class LeaseLost extends Error {}

/** Start (or continue) a RUNNING run in the background: the queue when there is one, otherwise after() in this process. */
export async function kickGroupAddRun(runId: string): Promise<void> {
  if (isQueueConfigured()) {
    await enqueue("whatsapp-group-add", { runId });
    return;
  }
  groupAddRuntime.schedule(async () => {
    await runGroupAddRun(runId);
  });
}

// ── Credentials and the live state of the number ─────────────────────────────

/** The credentials of an Evolution connection, or null when they can't be read or are incomplete. */
export function credsFromEnc(credentialsEnc: string): EvoCreds | null {
  try {
    return resolveEvoCreds(decryptCredentials(credentialsEnc));
  } catch {
    return null;
  }
}

/**
 * The run's own connection, found inside the run's organization before anything is decrypted: its credentials, and
 * whether the row is ACTIVE ("Desconectar" in Conversas deletes the instance at Evolution and marks the row INACTIVE;
 * a reconnect, with any phone, marks it ACTIVE again). Null when it is gone or its credentials can't be read.
 */
async function loadRunConnection(run: {
  connectionId: string;
  organizationId: string;
}): Promise<{ creds: EvoCreds; active: boolean } | null> {
  const conn = await prisma.integrationConnection.findFirst({
    where: { id: run.connectionId, organizationId: run.organizationId, provider: "EVOLUTION" },
    select: { credentialsEnc: true, status: true },
  });
  const creds = conn ? credsFromEnc(conn.credentialsEnc) : null;
  return conn && creds ? { creds, active: conn.status === "ACTIVE" } : null;
}

/**
 * Whether the instance is still linked to the run's number (`senderKey`): a reconnect in Conversas keeps the instance
 * and can bring another phone, under which the run must not go on. One fetchInstances.
 */
export async function checkLinkedNumber(creds: EvoCreds, senderKey: string): Promise<LinkedNumber> {
  return linkedNumber(await fetchOwnerJid(creds), senderKey);
}

/** connectionState, given up on (not ok) when it takes longer than STATE_TIMEOUT_MS. */
export async function liveState(creds: EvoCreds): Promise<{ ok: boolean; state: EvoState }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silent = new Promise<{ ok: false; state: "unknown" }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, state: "unknown" }), STATE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([connectionState(creds), silent]);
  } finally {
    clearTimeout(timer);
  }
}

// ── The queue of a number ────────────────────────────────────────────────────

/** One lock per number, held to the end of the transaction: the checks and writes of its queue never interleave. */
async function lockNumber(tx: Pick<Prisma.TransactionClient, "$queryRaw">, senderKey: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`whatsapp_group_add:${senderKey}`}))`;
}

const QUEUE_TX = { maxWait: 5_000, timeout: 10_000 };

/** When the next person may be tried after a try at `from`: a random pause of 30 to 90 s, moved into the window (and said so then). */
function pauseAfter(from: Date): { at: Date; reason: "pace" | "window" } {
  const seconds = pickPauseSeconds(groupAddRuntime.random);
  const at = nextAttemptAt(from, seconds);
  return { at, reason: at.getTime() > from.getTime() + seconds * 1000 ? "window" : "pace" };
}

/**
 * The pause between people belongs to the number, not to the round: a run that starts (or starts again) on a number owes
 * it to the last try made there by any run, in any organization (one aggregate, no row is read). The later of that and
 * the run's own time, which this never shortens. `waitReason` is null when the run's own time stays.
 */
async function owedPause(
  tx: Pick<Prisma.TransactionClient, "whatsappGroupAddItem">,
  senderKey: string,
  own: Date | null,
): Promise<{ nextAttemptAt: Date | null; waitReason: "pace" | "window" | null }> {
  const { _max } = await tx.whatsappGroupAddItem.aggregate({ where: { senderKey }, _max: { processedAt: true } });
  if (!_max.processedAt) return { nextAttemptAt: own, waitReason: null };
  const pause = pauseAfter(_max.processedAt);
  if (own && own.getTime() >= pause.at.getTime()) return { nextAttemptAt: own, waitReason: null };
  return { nextAttemptAt: pause.at, waitReason: pause.reason };
}

/**
 * Raises the oldest QUEUED run of the number to RUNNING when nothing else holds it: no run
 * RUNNING and none PAUSED (a paused run keeps its place). In any organization, so it reads and
 * writes with the organizationId of the run it found. The run starts after the pause the number
 * owes to its last try (owedPause). The ids it raised (none or one); the caller kicks them.
 */
export async function promoteQueuedRuns(senderKey: string): Promise<string[]> {
  if (!senderKey) return [];
  return prisma.$transaction(async (tx) => {
    await lockNumber(tx, senderKey);
    const holding = await tx.whatsappGroupAddRun.count({ where: { senderKey, status: { in: ["RUNNING", "PAUSED"] } } });
    if (holding > 0) return [];
    const next = await tx.whatsappGroupAddRun.findFirst({
      where: { senderKey, status: "QUEUED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, organizationId: true, startedAt: true, nextAttemptAt: true },
    });
    if (!next) return [];
    const owed = await owedPause(tx, senderKey, next.nextAttemptAt);
    const res = await tx.whatsappGroupAddRun.updateMany({
      where: { id: next.id, organizationId: next.organizationId, status: "QUEUED" },
      data: {
        status: "RUNNING",
        startedAt: next.startedAt ?? groupAddRuntime.now(),
        nextAttemptAt: owed.nextAttemptAt,
        waitReason: owed.waitReason,
        pausedReason: null,
      },
    });
    return res.count === 1 ? [next.id] : [];
  }, QUEUE_TX);
}

/** promoteQueuedRuns, then kick what it raised. Never throws: whoever calls has already done its own work. */
export async function promoteAndKick(senderKey: string): Promise<void> {
  try {
    for (const id of await promoteQueuedRuns(senderKey)) await kickGroupAddRun(id);
  } catch (e) {
    console.error("[group-add] could not start the next run of a number", errorTag(e));
  }
}

/**
 * Takes a PAUSED run back: RUNNING, or QUEUED when another run is RUNNING on its number. With `only`,
 * only if it is still paused for that reason (and with that note): a pause made by hand since stays.
 * Running again, it owes the number the pause after its last try (owedPause), whoever made it.
 * Null when the run was not paused (any more).
 */
export async function reactivateRun(
  run: { id: string; organizationId: string; senderKey: string; startedAt: Date | null },
  only?: { pausedReason: string; lastError?: string },
): Promise<"RUNNING" | "QUEUED" | null> {
  return prisma.$transaction(async (tx) => {
    await lockNumber(tx, run.senderKey);
    const busy = await tx.whatsappGroupAddRun.count({
      where: { senderKey: run.senderKey, status: "RUNNING", id: { not: run.id } },
    });
    const status = busy > 0 ? ("QUEUED" as const) : ("RUNNING" as const);
    const own = await tx.whatsappGroupAddRun.findFirst({
      where: { id: run.id, organizationId: run.organizationId },
      select: { nextAttemptAt: true },
    });
    const owed = status === "RUNNING" ? await owedPause(tx, run.senderKey, own?.nextAttemptAt ?? null) : null;
    const res = await tx.whatsappGroupAddRun.updateMany({
      where: { id: run.id, organizationId: run.organizationId, status: "PAUSED", ...only },
      data: {
        status,
        pausedReason: null,
        waitReason: owed?.waitReason ?? null,
        lastError: null,
        ...(owed ? { nextAttemptAt: owed.nextAttemptAt } : {}),
        ...(status === "RUNNING" && !run.startedAt ? { startedAt: groupAddRuntime.now() } : {}),
      },
    });
    return res.count === 1 ? status : null;
  }, QUEUE_TX);
}

/**
 * A paused run whose instance is now linked to another phone: paused for that ("number_changed"), which nothing
 * takes back by itself; "Retomar" does, once the run's own number is linked again. Only while it is still paused as
 * `only` says (a pause made by hand meanwhile stays).
 */
function pauseForChangedNumber(run: { id: string; organizationId: string }, only: { pausedReason: string; lastError?: string }) {
  return prisma.whatsappGroupAddRun.updateMany({
    where: { id: run.id, organizationId: run.organizationId, status: "PAUSED", ...only },
    data: { pausedReason: "number_changed", lastError: null },
  });
}

/**
 * The runs the cron (or a poke) should kick now: RUNNING, with the time of the next person
 * come (or none yet) and the lease free. Before that, in system context (the connection of each run
 * is found inside its organization before its credentials are opened), a paused run is taken back
 * (reactivateRun) when the number answers open again ("disconnected"), or when the group that could not
 * be read can be now and the number is admin of it (not_admin with the note "group_unreadable"; a
 * definite not_admin stays for "Retomar"). Only a run whose connection row is ACTIVE is looked at: a
 * number disconnected in the app costs no call until it is reconnected. And before it is taken back, the
 * instance must still be linked to the run's number: another phone pauses it as number_changed, and one
 * that can't be read leaves it as it is. A number with runs QUEUED and nobody holding it, which a
 * crash between two runs can leave, gets the oldest. `scope` narrows every read to some runs (a poke: one run).
 */
export async function findDueGroupAddRuns(now: Date, scope: Prisma.WhatsappGroupAddRunWhereInput = {}): Promise<string[]> {
  const paused = await prisma.whatsappGroupAddRun.findMany({
    where: {
      AND: [
        scope,
        { status: "PAUSED" },
        { OR: [{ pausedReason: "disconnected" }, { pausedReason: "not_admin", lastError: GROUP_UNREADABLE }] },
      ],
    },
    select: { id: true, organizationId: true, connectionId: true, senderKey: true, groupJid: true, startedAt: true, pausedReason: true },
  });
  for (const run of paused) {
    try {
      const conn = await loadRunConnection(run);
      if (!conn?.active) continue;
      const only = run.pausedReason === "disconnected" ? { pausedReason: "disconnected" } : { pausedReason: "not_admin", lastError: GROUP_UNREADABLE };
      if (run.pausedReason === "disconnected") {
        const state = await liveState(conn.creds);
        if (!state.ok || state.state !== "open") continue;
      } else {
        // Readable and the number admin: back. Unreadable, not admin or can't be told: left exactly as it is.
        const group = await fetchGroupSummary(conn.creds, run.groupJid);
        if (!group || isAdminOf(group, run.senderKey) !== true) continue;
      }
      const linked = await checkLinkedNumber(conn.creds, run.senderKey);
      if (linked === "same") await reactivateRun(run, only);
      else if (linked === "changed") await pauseForChangedNumber(run, only);
    } catch (e) {
      console.error("[group-add] could not take a run back", run.id, errorTag(e));
    }
  }

  const promoted: string[] = [];
  const waiting = await prisma.whatsappGroupAddRun.findMany({
    where: { AND: [scope, { status: "QUEUED" }] },
    distinct: ["senderKey"],
    select: { senderKey: true },
  });
  for (const { senderKey } of waiting) {
    try {
      promoted.push(...(await promoteQueuedRuns(senderKey)));
    } catch (e) {
      console.error("[group-add] could not start the next run of a number", errorTag(e));
    }
  }

  const due = await prisma.whatsappGroupAddRun.findMany({
    where: {
      AND: [
        scope,
        { status: "RUNNING" },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: new Date(now.getTime() - groupAddRuntime.leaseMs) } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return [...new Set([...promoted, ...due.map((r) => r.id)])];
}

/** People already tried today (São Paulo) with the number: counts only, across organizations. */
export function countUsedToday(senderKey: string, now: Date): Promise<number> {
  return prisma.whatsappGroupAddItem.count({
    where: { senderKey, status: { in: [...CAP_COUNTED] }, processedAt: { gte: saoPauloDayStart(now) } },
  });
}

// ── One visit of a runner to a run ───────────────────────────────────────────

/** What a runner holds while it works on a run: the run and the stamp of its lease, renewed by `beat`. */
type Visit = { id: string; org: string; stamp: Date };

const RUN_SELECT = {
  id: true,
  organizationId: true,
  connectionId: true,
  senderKey: true,
  groupJid: true,
  groupName: true,
  inviteText: true,
  inviteUrl: true,
  status: true,
  nextAttemptAt: true,
} as const;
type Run = Prisma.WhatsappGroupAddRunGetPayload<{ select: typeof RUN_SELECT }>;

/** Takes the lease; the stamp written (our token) or null when another runner is alive. */
async function takeLease(id: string, organizationId: string): Promise<Date | null> {
  const stamp = groupAddRuntime.now();
  const res = await prisma.whatsappGroupAddRun.updateMany({
    where: {
      id,
      organizationId,
      status: "RUNNING",
      OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: new Date(stamp.getTime() - groupAddRuntime.leaseMs) } }],
    },
    data: { lastDispatchAt: stamp },
  });
  return res.count === 1 ? stamp : null;
}

/**
 * Owner-checked heartbeat; throws LeaseLost when we are no longer the owner. The status of the run is not
 * part of the check on purpose: a pause or a cancel by hand is noticed by the loop (and by every piece of a
 * wait), which releases the lease at once, so a run resumed right after a pause is not kept waiting for a
 * lease that is still stamped.
 */
async function beat(v: Visit): Promise<void> {
  const next = new Date(Math.max(groupAddRuntime.now().getTime(), v.stamp.getTime() + 1));
  const res = await prisma.whatsappGroupAddRun.updateMany({
    where: { id: v.id, organizationId: v.org, lastDispatchAt: v.stamp },
    data: { lastDispatchAt: next },
  });
  if (res.count !== 1) throw new LeaseLost();
  v.stamp = next;
}

/** Gives the lease back, if it is still ours. */
function release(v: Visit) {
  return prisma.whatsappGroupAddRun.updateMany({
    where: { id: v.id, organizationId: v.org, lastDispatchAt: v.stamp },
    data: { lastDispatchAt: null },
  });
}

/**
 * The last write of a visit: the new state of the run, only while it is still RUNNING and ours, with
 * the lease released along. False when the run changed meanwhile (paused or canceled by hand): the
 * lease is released all the same and the change is left as it is.
 */
async function leave(v: Visit, data: Prisma.WhatsappGroupAddRunUpdateManyMutationInput): Promise<boolean> {
  const res = await prisma.whatsappGroupAddRun.updateMany({
    where: { id: v.id, organizationId: v.org, status: "RUNNING", lastDispatchAt: v.stamp },
    data: { ...data, lastDispatchAt: null },
  });
  if (res.count === 1) return true;
  await release(v);
  return false;
}

/** Marks the person that was in the hands of a runner that died or lost its lease: it may or may not have been tried, so never again. */
function sweepInterrupted(id: string, organizationId: string) {
  return prisma.whatsappGroupAddItem.updateMany({
    where: { runId: id, organizationId, status: "PROCESSING" },
    data: { status: "FAILED", reason: "interrupted" },
  });
}

function settle(v: Visit, itemId: string, data: Prisma.WhatsappGroupAddItemUpdateManyMutationInput) {
  return prisma.whatsappGroupAddItem.updateMany({ where: { id: itemId, organizationId: v.org, status: "PROCESSING" }, data });
}

/** Sleeps `ms` in pieces of at most chunkMs, renewing the lease before each. False when the run stopped being RUNNING meanwhile. */
async function waitFor(v: Visit, ms: number): Promise<boolean> {
  const rt = groupAddRuntime;
  for (let left = ms; left > 0; ) {
    await beat(v);
    const piece = Math.min(left, rt.chunkMs);
    await rt.sleep(piece);
    left -= piece;
    const now = await prisma.whatsappGroupAddRun.findFirst({ where: { id: v.id, organizationId: v.org }, select: { status: true } });
    if (now?.status !== "RUNNING") return false;
  }
  return true;
}

type Added = { outcome: "ADDED" | "NEEDS_INVITE" | "ALREADY_IN" | "FAILED"; reason: string | null };

/**
 * How the answer to an add reads: no answer at all is uncertain (it may have been added), then the HTTP status, then the
 * code of the number. A gateway's 502, 503 or 504 and a 2xx with no code are written as they came (`http_<n>`,
 * `unknown_answer`) and are doubts all the same (UNCERTAIN_REASONS): no later round redoes them.
 */
function classifyAdd(res: { httpStatus: number; code: string | null }): Added {
  if (res.httpStatus === 0) return { outcome: "FAILED", reason: "uncertain" };
  if (res.httpStatus < 200 || res.httpStatus > 299) return { outcome: "FAILED", reason: `http_${res.httpStatus}` };
  if (res.code === null) return { outcome: "FAILED", reason: "unknown_answer" };
  // A code that isn't one of the three known is FAILED with no reason: the code is on the item.
  return { outcome: outcomeFromCode(res.code), reason: null };
}

/**
 * The private text with the link for a person whose privacy settings refuse an add. The link is
 * asked once per run and kept on it; the text is never built without it. The window is read again:
 * an add that took the clock past 20:00 does not send the text. A send that gets no answer at all, or
 * a gateway's (UNCERTAIN_HTTP_STATUSES), may have gone out: it is invite_uncertain, which no later round
 * redoes; any other refusal is invite_failed.
 */
async function inviteByText(
  v: Visit,
  run: Run,
  creds: EvoCreds,
  item: { contactName: string },
  number: string,
): Promise<{ status: "INVITED" | "FAILED"; reason: string | null }> {
  let url = run.inviteUrl;
  if (!url) {
    await beat(v);
    url = await fetchGroupInviteUrl(creds, run.groupJid);
    if (url) {
      await prisma.whatsappGroupAddRun.updateMany({ where: { id: v.id, organizationId: v.org, inviteUrl: null }, data: { inviteUrl: url } });
    }
  }
  if (!url) return { status: "FAILED", reason: "no_invite_link" };
  if (!isInsideWindow(groupAddRuntime.now())) return { status: "FAILED", reason: "invite_failed" };
  await beat(v);
  const text = renderInvite(run.inviteText, { nome: item.contactName, grupo: run.groupName }, url);
  const sent = await sendPlainText(creds, number, text);
  if (sent.ok) return { status: "INVITED", reason: null };
  const mayHaveGone = sent.httpStatus === 0 || (UNCERTAIN_HTTP_STATUSES as readonly number[]).includes(sent.httpStatus);
  return { status: "FAILED", reason: mayHaveGone ? "invite_uncertain" : "invite_failed" };
}

/**
 * Whether the person asked not to be contacted since the round was planned: the contact itself, or any contact of the
 * run's organization with the same number (the plan's key, so any way of writing it). Read at the person's turn.
 */
async function optedOutNow(organizationId: string, item: { contactId: string; phoneKey: string | null }): Promise<boolean> {
  const asked = await prisma.contact.findMany({
    where: { organizationId, optedOut: true, OR: [{ id: item.contactId }, { phone: { not: null } }] },
    select: { id: true, phone: true },
  });
  return asked.some((c) => c.id === item.contactId || (item.phoneKey !== null && phoneMatchKey(c.phone) === item.phoneKey));
}

/**
 * One person: reserved, looked up, added and, when WhatsApp asks for the link instead, sent the
 * link by text. "again" when nothing was asked of the add (someone else reserved the person, the
 * person has no WhatsApp account, the window closed first): no pause follows. Otherwise the status
 * the person ended in; the pause between people is the caller's.
 */
async function tryPerson(
  v: Visit,
  run: Run,
  creds: EvoCreds,
  item: { id: string; contactId: string; contactName: string; phone: string | null; phoneKey: string | null },
): Promise<"again" | "ADDED" | "INVITED" | "ALREADY_IN" | "FAILED"> {
  const rt = groupAddRuntime;
  // An opt-out made since the plan: nothing is asked of WhatsApp about this person, and no pause is spent on them.
  if (await optedOutNow(v.org, item)) {
    await prisma.whatsappGroupAddItem.updateMany({
      where: { id: item.id, organizationId: v.org, runId: v.id, status: "PENDING" },
      data: { status: "SKIPPED", reason: "opted_out" },
    });
    return "again";
  }
  // Reserved only while the run is still RUNNING, and stamped now: if the runner dies from here on, the
  // try counts for the day (the person may have been added) and is never redone.
  const claim = await prisma.whatsappGroupAddItem.updateMany({
    where: { id: item.id, organizationId: v.org, runId: v.id, status: "PENDING", run: { status: "RUNNING" } },
    data: { status: "PROCESSING", processedAt: rt.now() },
  });
  if (claim.count !== 1) return "again";
  const number = item.phone;
  if (!number) {
    await settle(v, item.id, { status: "SKIPPED", reason: "no_phone", processedAt: null });
    return "again";
  }

  await beat(v);
  if ((await checkOnWhatsapp(creds, number)) === false) {
    await settle(v, item.id, { status: "NO_WHATSAPP", processedAt: null });
    return "again";
  }
  // The clock is read again: the calls above may have taken it past 20:00. The person goes back to PENDING.
  if (!isInsideWindow(rt.now())) {
    await prisma.whatsappGroupAddItem.updateMany({
      where: { id: item.id, organizationId: v.org, status: "PROCESSING" },
      data: { status: "PENDING", processedAt: null },
    });
    return "again";
  }

  await beat(v);
  const answer = await addGroupParticipant(creds, run.groupJid, number);
  const added = classifyAdd(answer);
  let status: "ADDED" | "INVITED" | "ALREADY_IN" | "FAILED";
  let reason = added.reason;
  if (added.outcome === "NEEDS_INVITE") {
    const invited = await inviteByText(v, run, creds, item, number);
    status = invited.status;
    reason = invited.reason;
  } else {
    status = added.outcome;
  }
  await settle(v, item.id, { status, code: answer.code, reason, processedAt: rt.now() });
  return status;
}

type Visited = { done: boolean; retryAfterSec?: number };

/**
 * Works on a RUNNING run until it is done, paused, or has to wait: one person at a time, each
 * after the pause of 30 to 90 s from the one before, only inside the window (08:00-20:00 São
 * Paulo) and below the number's cap of a day. A wait of the pace (shorter than the lease) is slept
 * here, renewing the lease; a longer one (the window, the cap, an unreachable Evolution) releases
 * the lease and answers `retryAfterSec` for the queue (the cron, a poke or "Retomar" take it up
 * where there is no queue). Before its first person a visit asks that the instance is still linked to
 * the run's number: another phone pauses the run as "number_changed". `budgetMs` ends the visit in
 * time for a queue job. Never throws once it holds the lease: an unexpected error pauses the run as "error".
 */
export async function runGroupAddRun(runId: string, opts: { budgetMs?: number } = {}): Promise<Visited> {
  const rt = groupAddRuntime;
  const first = await prisma.whatsappGroupAddRun.findFirst({ where: { id: runId }, select: RUN_SELECT });
  if (!first || first.status !== "RUNNING") return { done: true };
  const stamp = await takeLease(first.id, first.organizationId);
  if (!stamp) return { done: true }; // another runner is alive
  const v: Visit = { id: first.id, org: first.organizationId, stamp };

  /** Stops for a wait too long to sleep here. */
  const park = async (reason: "window" | "cap" | "unavailable", until: Date): Promise<Visited> => {
    if (!(await leave(v, { nextAttemptAt: until, waitReason: reason }))) return { done: true };
    return { done: false, retryAfterSec: Math.max(1, Math.ceil((until.getTime() - rt.now().getTime()) / 1000)) };
  };
  /** Evolution can't say what is needed now: asked again in a few minutes. */
  const unavailable = () => park("unavailable", new Date(rt.now().getTime() + UNAVAILABLE_WAIT_MS));
  const pause = async (
    reason: "no_connection" | "disconnected" | "not_admin" | "number_changed",
    lastError: string | null = null,
  ): Promise<Visited> => {
    await leave(v, { status: "PAUSED", pausedReason: reason, waitReason: null, lastError });
    return { done: true };
  };

  try {
    // Only the lease owner sweeps, and before anything can stop the visit.
    await sweepInterrupted(v.id, v.org);
    const deadline = opts.budgetMs ? rt.now().getTime() + opts.budgetMs : Number.POSITIVE_INFINITY;
    // Asked once a visit, before its first person: a run parked for hours does not go on under another phone.
    let numberChecked = false;
    // Asked again for the first person of a visit (a start, a resume, the next day) and after a person who failed.
    let adminChecked = false;

    for (;;) {
      const run = await prisma.whatsappGroupAddRun.findFirst({ where: { id: v.id, organizationId: v.org }, select: RUN_SELECT });
      if (!run || run.status !== "RUNNING") {
        await release(v);
        return { done: true };
      }
      const item = await prisma.whatsappGroupAddItem.findFirst({
        where: { runId: v.id, organizationId: v.org, status: "PENDING" },
        orderBy: { position: "asc" },
        select: { id: true, contactId: true, contactName: true, phone: true, phoneKey: true },
      });
      if (!item) {
        // Nobody left: done at once, whatever the hour or the pause.
        if (await leave(v, { status: "DONE", finishedAt: rt.now(), nextAttemptAt: null, waitReason: null })) {
          await promoteAndKick(run.senderKey);
        }
        return { done: true };
      }

      const now = rt.now();
      if (!isInsideWindow(now)) return await park("window", nextWindowStart(now));
      if ((await countUsedToday(run.senderKey, now)) >= GROUP_ADD_DAILY_CAP) return await park("cap", capResumeAt(now));
      if (run.nextAttemptAt && run.nextAttemptAt.getTime() > now.getTime()) {
        const ms = run.nextAttemptAt.getTime() - now.getTime();
        if (ms >= rt.leaseMs || now.getTime() + ms > deadline) {
          await release(v);
          return { done: false, retryAfterSec: Math.ceil(ms / 1000) };
        }
        if (!(await waitFor(v, ms))) {
          await release(v);
          return { done: true };
        }
        continue; // the run, the hour and the cap are looked at again
      }

      const conn = await loadRunConnection(run);
      if (!conn) return await pause("no_connection");
      const { creds } = conn;
      await beat(v);
      const state = await liveState(creds);
      // No answer about the state: an outage while the row says the number is connected, but a number disconnected in the
      // app (row INACTIVE, instance deleted, so Evolution answers 404) is paused, not waited for.
      if (!state.ok) return conn.active ? await unavailable() : await pause("disconnected");
      if (state.state !== "open") return await pause("disconnected");
      if (!numberChecked) {
        await beat(v);
        const linked = await checkLinkedNumber(creds, run.senderKey);
        if (linked === "changed") return await pause("number_changed");
        if (linked === "unknown") return await unavailable();
        numberChecked = true;
      }
      if (!adminChecked) {
        await beat(v);
        const group = await fetchGroupSummary(creds, run.groupJid);
        if (!group) return await pause("not_admin", GROUP_UNREADABLE);
        if (isAdminOf(group, run.senderKey) !== true) return await pause("not_admin");
        adminChecked = true;
      }

      const turn = await tryPerson(v, run, creds, item);
      if (turn === "again") continue;
      if (turn === "FAILED") adminChecked = false;
      const pace = pauseAfter(rt.now());
      // Written for the owner of the lease only, not for a RUNNING run: a pause made by hand meanwhile keeps it.
      const res = await prisma.whatsappGroupAddRun.updateMany({
        where: { id: v.id, organizationId: v.org, lastDispatchAt: v.stamp },
        data: { nextAttemptAt: pace.at, waitReason: pace.reason },
      });
      if (res.count !== 1) throw new LeaseLost();
    }
  } catch (e) {
    if (e instanceof LeaseLost) return { done: true }; // someone else owns it now
    console.error("[group-add] run failed", v.id, errorTag(e));
    try {
      // The person in our hands may or may not have been tried: never again. Only after the pause is ours.
      if (await leave(v, { status: "PAUSED", pausedReason: "error", waitReason: null, lastError: errorTag(e).slice(0, 200) })) {
        await sweepInterrupted(v.id, v.org);
      }
    } catch (e2) {
      console.error("[group-add] could not pause after a failure", v.id, errorTag(e2));
    }
    return { done: true };
  }
}
