"use server";

import { revalidatePath } from "next/cache";
import { hasModule } from "@/config/modules";
import { canAccessScreen } from "@/lib/access";
import { audit } from "@/lib/audit";
import { getGroupAddRunView, type GroupAddRunView } from "@/lib/queries/whatsapp-group-add";
import { getOrgContext, hasRole, type OrgContext } from "@/lib/tenant";
import { groupAddPreviewSchema, groupAddRunIdSchema, groupAddStartSchema } from "@/lib/validations/whatsapp-group-add";
import { errorTag } from "@/lib/whatsapp/group-add/runner";
import {
  cancelGroupAdd,
  listMyGroups,
  pauseGroupAdd,
  pokeGroupAdd,
  previewGroupAdd,
  resumeGroupAdd,
  startGroupAdd,
  type GroupAddError,
  type GroupOption,
} from "@/lib/whatsapp/group-add/service";

/**
 * "Adicionar a grupo do WhatsApp" for the screens (spec 2026-10-28): list the groups of the member's own number, review a
 * round, start it, pause, resume, cancel, and poke the tracking screen's round. Who may do what is decided here; the
 * work is the service's (src/lib/whatsapp/group-add/service.ts). Nothing here logs a phone number or the invite text:
 * a failure writes the name and code of the error only. The audit entries carry the round (entityId) and the group's
 * NAME, never a JID, a phone or the invite text (the old kind of group JID holds its creator's phone, and the audit
 * table is long-lived): `npm run check:group-add` reads this file and fails if an entry's meta says otherwise.
 */

export type GroupAddActionError = GroupAddError | "unauthorized" | "forbidden" | "invalid" | "unknown";
export type GroupAddActionFail = { ok: false; error: GroupAddActionError };
/** What the review before a round answers: the same as the service's, with the same counts. */
export type GroupAddPreview = Extract<Awaited<ReturnType<typeof previewGroupAdd>>, { ok: true }>;

type Gate = { ok: true; ctx: OrgContext } | GroupAddActionFail;

/**
 * Session + the "contacts" screen + the CRM and Atendimento modules (the number is the one of Conversas) — the same gates as
 * the screens, repeated because server actions are public endpoints.
 */
async function gate(): Promise<Gate> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (!canAccessScreen(ctx, "contacts") || !hasModule(ctx.modules, "crm") || !hasModule(ctx.modules, "inbox")) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, ctx };
}

type Loaded = { ok: true; id: string; run: GroupAddRunView } | GroupAddActionFail;

/**
 * The round the caller names: the id parsed, then read through `tenantDb`, so the id of another company's round is as good as
 * none (`not_found`, never `forbidden`: it does not say the round exists). With `steer`, only the member who started it, or
 * an admin or the owner, goes on: pause, resume and cancel. Looking (poke) takes the gate alone.
 */
async function loadRun(ctx: OrgContext, runId: unknown, steer: boolean): Promise<Loaded> {
  const id = groupAddRunIdSchema.safeParse(runId);
  if (!id.success) return { ok: false, error: "invalid" };
  const run = await getGroupAddRunView(ctx.organizationId, id.data);
  if (!run) return { ok: false, error: "not_found" };
  if (steer && run.createdById !== ctx.userId && !hasRole(ctx.role, "ADMIN")) return { ok: false, error: "forbidden" };
  return { ok: true, id: id.data, run };
}

const trackingPath = (runId: string) => `/app/contacts/grupos/${runId}`;

const failed = (what: string, error: unknown): GroupAddActionFail => {
  console.error(`[group-add] ${what} failed`, errorTag(error));
  return { ok: false, error: "unknown" };
};

/** The groups of the member's own number (the connection of Conversas), by name, with whether the number is admin of each. */
export async function listGroupsForAddAction(): Promise<{ ok: true; groups: GroupOption[] } | GroupAddActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    return await listMyGroups(g.ctx.organizationId, g.ctx.userId);
  } catch (error) {
    return failed("listing the groups", error);
  }
}

/** The review before a round: the counts, what the number spent today, when it would end, whether the group would overflow. Writes nothing. */
export async function previewGroupAddAction(input: unknown): Promise<GroupAddPreview | GroupAddActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = groupAddPreviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    return await previewGroupAdd(g.ctx.organizationId, g.ctx.userId, parsed.data.source, parsed.data.groupJid);
  } catch (error) {
    return failed("the preview", error);
  }
}

export async function startGroupAddAction(input: unknown): Promise<{ ok: true; runId: string } | GroupAddActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  const parsed = groupAddStartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const res = await startGroupAdd(g.ctx.organizationId, g.ctx.userId, parsed.data);
    if (!res.ok) return res;
    // The group by its name, like the other three entries: never its JID (the old kind, `<phone>-<timestamp>@g.us`, holds the
    // phone of whoever made the group, and this table is long-lived), who the people are, or what the invite says.
    await audit(g.ctx, {
      action: "whatsapp_group_add.started",
      entity: "WhatsappGroupAddRun",
      entityId: res.runId,
      meta: { groupName: res.groupName },
    });
    revalidatePath(trackingPath(res.runId));
    return { ok: true, runId: res.runId };
  } catch (error) {
    return failed("the start", error);
  }
}

export async function pauseGroupAddAction(runId: string): Promise<{ ok: true } | GroupAddActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const own = await loadRun(g.ctx, runId, true);
    if (!own.ok) return own;
    // Nothing to pause (already paused, done or canceled) is the same answer as a round that is not there.
    if (!(await pauseGroupAdd(g.ctx.organizationId, own.id))) return { ok: false, error: "not_found" };
    await audit(g.ctx, {
      action: "whatsapp_group_add.paused",
      entity: "WhatsappGroupAddRun",
      entityId: own.id,
      meta: { groupName: own.run.groupName },
    });
    revalidatePath(trackingPath(own.id));
    return { ok: true };
  } catch (error) {
    return failed("the pause", error);
  }
}

export async function resumeGroupAddAction(runId: string): Promise<{ ok: true } | GroupAddActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const own = await loadRun(g.ctx, runId, true);
    if (!own.ok) return own;
    const res = await resumeGroupAdd(g.ctx.organizationId, own.id);
    if (!res.ok) return res;
    await audit(g.ctx, {
      action: "whatsapp_group_add.resumed",
      entity: "WhatsappGroupAddRun",
      entityId: own.id,
      meta: { groupName: own.run.groupName },
    });
    revalidatePath(trackingPath(own.id));
    return { ok: true };
  } catch (error) {
    return failed("the resume", error);
  }
}

export async function cancelGroupAddAction(runId: string): Promise<{ ok: true } | GroupAddActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const own = await loadRun(g.ctx, runId, true);
    if (!own.ok) return own;
    if (!(await cancelGroupAdd(g.ctx.organizationId, own.id))) return { ok: false, error: "not_found" };
    await audit(g.ctx, {
      action: "whatsapp_group_add.canceled",
      entity: "WhatsappGroupAddRun",
      entityId: own.id,
      meta: { groupName: own.run.groupName },
    });
    revalidatePath(trackingPath(own.id));
    return { ok: true };
  } catch (error) {
    return failed("the cancel", error);
  }
}

/**
 * Called when the tracking screen opens, for where there is no cron: kicks the round if it is due (service: pokeGroupAdd).
 * Any member who can see the round may do it, not only who started it: it only helps a round that is meant to go on.
 */
export async function pokeGroupAddAction(runId: string): Promise<{ ok: true } | GroupAddActionFail> {
  const g = await gate();
  if (!g.ok) return g;
  try {
    const own = await loadRun(g.ctx, runId, false);
    if (!own.ok) return own;
    await pokeGroupAdd(g.ctx.organizationId, own.id);
    return { ok: true };
  } catch (error) {
    return failed("the poke", error);
  }
}
