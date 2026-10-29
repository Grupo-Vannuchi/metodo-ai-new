import "server-only";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { fetchAllGroups, fetchGroupSummary, fetchOwnerJid, type EvoCreds } from "@/lib/integrations/evolution-client";
import { isAdminOf, jidDigits, type EvoGroupSummary } from "@/lib/integrations/evolution-groups";
import {
  GROUP_ADD_MAX_CONTACTS,
  INVITE_TEXT_MAX,
  WHATSAPP_GROUP_MAX,
  countPlan,
  forecastFinish,
  phoneMatchKey,
  planGroupAdd,
  type CandidateInput,
  type GroupAddCounts,
  type PlannedItem,
  type PreviousOutcome,
} from "./core";
import {
  countUsedToday,
  credsFromEnc,
  errorTag,
  findDueGroupAddRuns,
  groupAddRuntime,
  kickGroupAddRun,
  liveState,
  promoteAndKick,
  reactivateRun,
} from "./runner";

/**
 * What a member does with "Adicionar a grupo do WhatsApp": list the groups of their own number, preview a
 * round, start it, pause, resume, cancel. Member scope: the organization's data goes through `tenantDb`
 * (by-id work with findFirst + updateMany); the parts that cross organizations (the queue of a number and
 * its cap of a day) are the runner's, which reads only counts and ids. Who may do what is the action's call.
 */

export type GroupOption = { jid: string; subject: string; size: number; announce: boolean | null; admin: boolean | null };
export type GroupAddSource = { kind: "folder"; folderId: string | null } | { kind: "contacts"; contactIds: string[] };
export type GroupAddError =
  | "no_connection"
  | "disconnected"
  | "unavailable"
  | "not_admin"
  | "not_found"
  | "empty"
  | "already_running";
type Failure = { ok: false; error: GroupAddError };

/** A round in one of these holds its group: no second round starts for it. */
const OPEN_STATUSES = ["QUEUED", "RUNNING", "PAUSED"] as const;

// ── The caller's number ──────────────────────────────────────────────────────

type Link = { ok: true; connectionId: string; creds: EvoCreds; senderKey: string } | Failure;

/**
 * The number the caller uses: their own newest active Evolution connection (never a colleague's), open
 * right now at Evolution (the row may still say ACTIVE for a number that dropped). `senderKey` is the
 * phone behind the instance, empty when Evolution doesn't say: no group can be confirmed as theirs then.
 */
async function openLink(db: TenantDb, userId: string): Promise<Link> {
  const conn = await db.integrationConnection.findFirst({
    where: { ownerId: userId, provider: "EVOLUTION", status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { id: true, credentialsEnc: true },
  });
  const creds = conn ? credsFromEnc(conn.credentialsEnc) : null;
  if (!conn || !creds) return { ok: false, error: "no_connection" };
  const state = await liveState(creds);
  if (!state.ok) return { ok: false, error: "unavailable" };
  if (state.state !== "open") return { ok: false, error: "disconnected" };
  const ownerJid = await fetchOwnerJid(creds);
  return { ok: true, connectionId: conn.id, creds, senderKey: ownerJid ? jidDigits(ownerJid) : "" };
}

function optionOf(group: EvoGroupSummary, senderKey: string): GroupOption {
  return {
    jid: group.jid,
    subject: group.subject,
    size: group.size,
    announce: group.announce,
    admin: isAdminOf(group, senderKey),
  };
}

/** Every group of the caller's number, by name; `admin` true / false, or null when the number can't be told (the screen blocks those too). */
export async function listMyGroups(
  organizationId: string,
  userId: string,
): Promise<{ ok: true; groups: GroupOption[] } | Failure> {
  const link = await openLink(tenantDb(organizationId), userId);
  if (!link.ok) return link;
  const groups = await fetchAllGroups(link.creds);
  if (!groups) return { ok: false, error: "unavailable" };
  return {
    ok: true,
    groups: groups.map((g) => optionOf(g, link.senderKey)).sort((a, b) => a.subject.localeCompare(b.subject, "pt-BR")),
  };
}

// ── The plan of a round ──────────────────────────────────────────────────────

/** The contacts of the source, in the order the round will go through them, from this organization only. */
async function sourceContacts(db: TenantDb, source: GroupAddSource) {
  const select = { id: true, name: true, phone: true, optedOut: true } as const;
  if (source.kind === "folder") {
    if (source.folderId !== null && !(await db.contactFolder.findFirst({ where: { id: source.folderId }, select: { id: true } }))) {
      return null;
    }
    return db.contact.findMany({
      where: { folderId: source.folderId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: GROUP_ADD_MAX_CONTACTS,
      select,
    });
  }
  const ids = [...new Set(source.contactIds)].slice(0, GROUP_ADD_MAX_CONTACTS);
  const found = ids.length ? await db.contact.findMany({ where: { id: { in: ids } }, select }) : [];
  const byId = new Map(found.map((c) => [c.id, c]));
  return ids.flatMap((id) => {
    const contact = byId.get(id);
    return contact ? [contact] : [];
  });
}

/**
 * What the round does with each contact (planGroupAdd) against the members the group has now and
 * what earlier rounds of the same organization did with it. A contact whose number belongs to an
 * opted-out contact of the organization, inside the selection or not, is opted out too.
 */
async function planFor(
  db: TenantDb,
  organizationId: string,
  source: GroupAddSource,
  group: EvoGroupSummary,
  groupJid: string,
): Promise<{ ok: true; plan: PlannedItem[] } | { ok: false; error: "not_found" | "empty" }> {
  const contacts = await sourceContacts(db, source);
  if (contacts === null) return { ok: false, error: "not_found" };
  if (contacts.length === 0) return { ok: false, error: "empty" };

  const optedOut = await db.contact.findMany({ where: { optedOut: true, phone: { not: null } }, select: { phone: true } });
  const blocked = new Set<string>();
  for (const { phone } of optedOut) {
    const key = phoneMatchKey(phone);
    if (key !== null) blocked.add(key);
  }
  const candidates: CandidateInput[] = contacts.map((c) => {
    const key = phoneMatchKey(c.phone);
    return { contactId: c.id, name: c.name, phone: c.phone, optedOut: c.optedOut || (key !== null && blocked.has(key)) };
  });

  const members = new Set<string>();
  for (const p of group.participants) {
    const key = phoneMatchKey(p.number);
    if (key !== null) members.add(key);
  }
  const earlier = await db.whatsappGroupAddItem.findMany({
    where: { status: { in: ["ADDED", "INVITED"] }, phoneKey: { not: null }, run: { groupJid, organizationId } },
    select: { phoneKey: true, status: true },
  });
  const previous: PreviousOutcome[] = earlier.flatMap((i) =>
    i.phoneKey !== null && (i.status === "ADDED" || i.status === "INVITED") ? [{ phoneKey: i.phoneKey, status: i.status }] : [],
  );
  return { ok: true, plan: planGroupAdd(candidates, members, previous) };
}

type Prepared = { ok: true; group: EvoGroupSummary; plan: PlannedItem[] } | Failure;

/** The group as it is now, and the plan against it. The number must be admin of it. */
async function prepare(
  db: TenantDb,
  organizationId: string,
  link: Extract<Link, { ok: true }>,
  source: GroupAddSource,
  groupJid: string,
): Promise<Prepared> {
  const group = await fetchGroupSummary(link.creds, groupJid);
  if (!group) return { ok: false, error: "not_found" };
  if (isAdminOf(group, link.senderKey) !== true) return { ok: false, error: "not_admin" };
  const planned = await planFor(db, organizationId, source, group, groupJid);
  return planned.ok ? { ok: true, group, plan: planned.plan } : planned;
}

/** How many more people the group takes. */
const roomIn = (group: EvoGroupSummary) => Math.max(0, WHATSAPP_GROUP_MAX - group.size);

/** The review before a round: the counts, what the number spent today, when it would end and whether the group would overflow. Writes nothing. */
export async function previewGroupAdd(
  organizationId: string,
  userId: string,
  source: GroupAddSource,
  groupJid: string,
): Promise<
  | { ok: true; group: GroupOption; counts: GroupAddCounts; usedToday: number; forecastAt: string; overLimit: boolean }
  | Failure
> {
  const db = tenantDb(organizationId);
  const link = await openLink(db, userId);
  if (!link.ok) return link;
  const ready = await prepare(db, organizationId, link, source, groupJid);
  if (!ready.ok) return ready;
  const counts = countPlan(ready.plan);
  const now = groupAddRuntime.now();
  const usedToday = await countUsedToday(link.senderKey, now);
  return {
    ok: true,
    group: optionOf(ready.group, link.senderKey),
    counts,
    usedToday,
    // For the people who fit: the rest of the plan will not be tried.
    forecastAt: forecastFinish(now, Math.min(counts.pending, roomIn(ready.group)), usedToday).toISOString(),
    overLimit: ready.group.size + counts.pending > WHATSAPP_GROUP_MAX,
  };
}

// ── Start, pause, resume, cancel ─────────────────────────────────────────────

const activeRunOf = (db: TenantDb, groupJid: string) =>
  db.whatsappGroupAddRun.findFirst({ where: { groupJid, status: { in: [...OPEN_STATUSES] } }, select: { id: true } });

/**
 * Starts a round: re-reads the group, plans it, writes the run (QUEUED) with an item per contact and
 * raises the oldest queued run of the number, which may be this one. The people that don't fit in the
 * group (1,024) start FAILED / group_full, never tried and not counted for the day. One round at a
 * time per group of an organization: two clicks make one.
 */
export async function startGroupAdd(
  organizationId: string,
  userId: string,
  input: { source: GroupAddSource; groupJid: string; inviteText: string },
): Promise<{ ok: true; runId: string } | Failure> {
  const db = tenantDb(organizationId);
  const link = await openLink(db, userId);
  if (!link.ok) return link;
  if (await activeRunOf(db, input.groupJid)) return { ok: false, error: "already_running" };
  const ready = await prepare(db, organizationId, link, input.source, input.groupJid);
  if (!ready.ok) return ready;

  let room = roomIn(ready.group);
  const rows = ready.plan.map((item) => {
    if (item.status !== "PENDING") return { ...item, reason: item.reason as string | null };
    if (room > 0) {
      room--;
      return { ...item, reason: null as string | null };
    }
    return { ...item, status: "FAILED" as const, reason: "group_full" as string | null };
  });

  const runId = await db.$transaction(
    async (tx) => {
      // The check and the write under one lock per group, so two clicks at the same moment can't both pass it.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`whatsapp_group_add_start:${organizationId}:${input.groupJid}`}))`;
      const open = await tx.whatsappGroupAddRun.findFirst({
        where: { organizationId, groupJid: input.groupJid, status: { in: [...OPEN_STATUSES] } },
        select: { id: true },
      });
      if (open) return null;
      const run = await tx.whatsappGroupAddRun.create({
        data: {
          organizationId,
          connectionId: link.connectionId,
          senderKey: link.senderKey,
          createdById: userId,
          groupJid: input.groupJid,
          groupName: ready.group.subject || "Grupo",
          inviteText: input.inviteText.slice(0, INVITE_TEXT_MAX),
          status: "QUEUED",
        },
        select: { id: true },
      });
      await tx.whatsappGroupAddItem.createMany({
        data: rows.map((item, position) => ({
          organizationId,
          runId: run.id,
          contactId: item.contactId,
          contactName: item.name,
          position,
          phone: item.phone,
          phoneKey: item.phoneKey,
          senderKey: link.senderKey,
          status: item.status,
          reason: item.reason,
        })),
      });
      return run.id;
    },
    { maxWait: 5_000, timeout: 20_000 },
  );
  if (!runId) return { ok: false, error: "already_running" };

  await promoteAndKick(link.senderKey);
  return { ok: true, runId };
}

/** QUEUED or RUNNING to PAUSED by hand. A pause is kept across a resume (the pause between people too). False when there was nothing to pause. */
export async function pauseGroupAdd(organizationId: string, runId: string): Promise<boolean> {
  const res = await tenantDb(organizationId).whatsappGroupAddRun.updateMany({
    where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "PAUSED", pausedReason: "manual", waitReason: null },
  });
  return res.count === 1;
}

/**
 * PAUSED to RUNNING, or to QUEUED when another round has the number. Asks again what a pause may
 * have changed: the run's own connection must be open and its number still admin of the group.
 */
export async function resumeGroupAdd(organizationId: string, runId: string): Promise<{ ok: true } | Failure> {
  const db = tenantDb(organizationId);
  const run = await db.whatsappGroupAddRun.findFirst({
    where: { id: runId },
    select: { id: true, connectionId: true, senderKey: true, groupJid: true, status: true, startedAt: true },
  });
  if (!run) return { ok: false, error: "not_found" };
  if (run.status === "QUEUED" || run.status === "RUNNING") return { ok: false, error: "already_running" };
  if (run.status !== "PAUSED") return { ok: false, error: "not_found" };

  const conn = await db.integrationConnection.findFirst({
    where: { id: run.connectionId, provider: "EVOLUTION" },
    select: { credentialsEnc: true },
  });
  const creds = conn ? credsFromEnc(conn.credentialsEnc) : null;
  if (!creds) return { ok: false, error: "no_connection" };
  const state = await liveState(creds);
  if (!state.ok) return { ok: false, error: "unavailable" };
  if (state.state !== "open") return { ok: false, error: "disconnected" };
  const group = await fetchGroupSummary(creds, run.groupJid);
  if (!group) return { ok: false, error: "not_found" };
  if (isAdminOf(group, run.senderKey) !== true) return { ok: false, error: "not_admin" };

  const status = await reactivateRun({ id: run.id, organizationId, senderKey: run.senderKey, startedAt: run.startedAt });
  if (!status) return { ok: false, error: "not_found" }; // changed meanwhile
  if (status === "RUNNING") await kickGroupAddRun(run.id);
  return { ok: true };
}

/**
 * QUEUED, RUNNING or PAUSED to CANCELED. The people not reached stay PENDING. Then the next run of the
 * number rises. False when there was nothing to cancel.
 */
export async function cancelGroupAdd(organizationId: string, runId: string): Promise<boolean> {
  const db = tenantDb(organizationId);
  const run = await db.whatsappGroupAddRun.findFirst({ where: { id: runId }, select: { senderKey: true } });
  if (!run) return false;
  const now = groupAddRuntime.now();
  const res = await db.whatsappGroupAddRun.updateMany({
    where: { id: runId, status: { in: [...OPEN_STATUSES] } },
    data: { status: "CANCELED", finishedAt: now, pausedReason: null, waitReason: null, nextAttemptAt: null },
  });
  if (res.count !== 1) return false;
  // A runner that died mid-call left its person PROCESSING and no one comes back to a canceled run. A live runner settles its own.
  await db.whatsappGroupAddItem.updateMany({
    where: {
      runId,
      status: "PROCESSING",
      run: { OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: new Date(now.getTime() - groupAddRuntime.leaseMs) } }] },
    },
    data: { status: "FAILED", reason: "interrupted" },
  });
  await promoteAndKick(run.senderKey);
  return true;
}

/**
 * Called when someone opens the tracking screen, for where there is no cron: kicks the run if it is due and
 * its lease is free, after taking it back if it was paused for a number that is open again. Another
 * organization's run is not found, so it is not kicked.
 */
export async function pokeGroupAdd(organizationId: string, runId: string): Promise<void> {
  const run = await tenantDb(organizationId).whatsappGroupAddRun.findFirst({ where: { id: runId }, select: { id: true } });
  if (!run) return;
  try {
    for (const id of await findDueGroupAddRuns(groupAddRuntime.now(), { id: run.id, organizationId })) await kickGroupAddRun(id);
  } catch (e) {
    console.error("[group-add] poke failed", run.id, errorTag(e));
  }
}
