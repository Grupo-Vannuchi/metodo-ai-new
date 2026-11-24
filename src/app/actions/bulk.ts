"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { audit } from "@/lib/audit";
import { FUNNEL_SEND_MAX, sendContactsToFunnel } from "@/lib/crm/contacts-to-funnel";
import {
  addContactsToFolder,
  isFolderArg,
  moveContactsToFolder,
  removeContactsFromFolder,
} from "@/lib/crm/contact-folder-links";

/**
 * Bulk operations for the folder explorers (contacts, companies): apply one
 * action to a selection at once. Every query is org-scoped through `tenantDb`,
 * and `updateMany`/`deleteMany` with an `id in [...]` filter can only touch this
 * tenant's rows, so a forged id from another org is simply a no-op.
 */

const MAX = 1000;

export type BulkResult =
  | { ok: true; count: number }
  | { ok: false; error: "unauthorized" | "empty" | "invalid" | "unknown" };

type OrgCtx = NonNullable<Awaited<ReturnType<typeof getOrgContext>>>;
type Prep = { error: "unauthorized" | "empty" } | { ctx: OrgCtx; ids: string[] };

/** Shared guards: session + a sane, non-empty id list. */
async function prep(ids: string[]): Promise<Prep> {
  const ctx = await getOrgContext();
  if (!ctx) return { error: "unauthorized" };
  if (!Array.isArray(ids) || ids.length === 0) return { error: "empty" };
  const clean = [...new Set(ids.filter((s) => typeof s === "string" && s))].slice(0, MAX);
  if (clean.length === 0) return { error: "empty" };
  return { ctx, ids: clean };
}

// ── Contacts ─────────────────────────────────────────────────────────────────

export async function bulkDeleteContacts(ids: string[]): Promise<BulkResult> {
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  try {
    const db = tenantDb(p.ctx.organizationId);
    const res = await db.contact.deleteMany({ where: { id: { in: p.ids } } });
    revalidatePath("/app/contacts");
    return { ok: true, count: res.count };
  } catch (error) {
    console.error("bulkDeleteContacts failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Move contacts out of the open folder (`fromFolderId`) into `folderId`,
 * keeping their other folders. `null` is "Sem pasta". Both must be `null` or an
 * id: a missing origin (an old client calling with two args) is refused, never
 * read as "every folder". */
export async function bulkMoveContacts(
  ids: string[],
  folderId: string | null,
  fromFolderId: string | null,
): Promise<BulkResult> {
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  if (!isFolderArg(folderId) || !isFolderArg(fromFolderId)) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(p.ctx.organizationId);
    const count = await moveContactsToFolder(db, p.ctx.organizationId, p.ids, folderId, fromFolderId);
    if (count === null) return { ok: false, error: "invalid" };
    revalidatePath("/app/contacts");
    return { ok: true, count };
  } catch (error) {
    console.error("bulkMoveContacts failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Add contacts to `folderId` too, keeping every folder they are already in. */
export async function bulkAddContactsToFolder(ids: string[], folderId: string): Promise<BulkResult> {
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  if (typeof folderId !== "string" || !folderId) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(p.ctx.organizationId);
    const count = await addContactsToFolder(db, p.ctx.organizationId, p.ids, folderId);
    if (count === null) return { ok: false, error: "invalid" };
    revalidatePath("/app/contacts");
    return { ok: true, count };
  } catch (error) {
    console.error("bulkAddContactsToFolder failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Take contacts out of one folder only; the rest of their folders stay. */
export async function bulkRemoveContactsFromFolder(ids: string[], folderId: string): Promise<BulkResult> {
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  if (typeof folderId !== "string" || !folderId) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(p.ctx.organizationId);
    const count = await removeContactsFromFolder(db, p.ids, folderId);
    revalidatePath("/app/contacts");
    return { ok: true, count };
  } catch (error) {
    console.error("bulkRemoveContactsFromFolder failed", error);
    return { ok: false, error: "unknown" };
  }
}

/** Add a tag to each selected contact without dropping the tags they already
 * have. Done row-by-row because Postgres arrays have no single-statement
 * "append if absent" through Prisma; the selection is capped at MAX. */
export async function bulkTagContacts(ids: string[], tag: string): Promise<BulkResult> {
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  const label = tag.trim().slice(0, 40);
  if (!label) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(p.ctx.organizationId);
    const rows = await db.contact.findMany({
      where: { id: { in: p.ids } },
      select: { id: true, tags: true },
    });
    let count = 0;
    for (const r of rows) {
      if (r.tags.includes(label)) continue;
      await db.contact.update({ where: { id: r.id }, data: { tags: [...r.tags, label] } });
      count++;
    }
    revalidatePath("/app/contacts");
    return { ok: true, count };
  } catch (error) {
    console.error("bulkTagContacts failed", error);
    return { ok: false, error: "unknown" };
  }
}

export type FunnelSendActionResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: "unauthorized" | "empty" | "invalid" | "tooMany" | "unknown" };

/** "Enviar ao funil": each contact becomes an opportunity in `stageId` (rules in src/lib/crm/contacts-to-funnel.ts). Needs the
 * contacts and the funnel screens. A selection over FUNNEL_SEND_MAX is refused, never cut. */
export async function bulkSendContactsToFunnel(
  ids: string[],
  stageId: string,
  productServiceId: string | null,
): Promise<FunnelSendActionResult> {
  if (Array.isArray(ids) && new Set(ids).size > FUNNEL_SEND_MAX) return { ok: false, error: "tooMany" };
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  if (!canAccessScreen(p.ctx, "contacts") || !canAccessScreen(p.ctx, "crm")) return { ok: false, error: "unauthorized" };
  if (typeof stageId !== "string" || !stageId || stageId.length > 40) return { ok: false, error: "invalid" };
  if (productServiceId !== null && (typeof productServiceId !== "string" || productServiceId.length > 40)) {
    return { ok: false, error: "invalid" };
  }
  try {
    const res = await sendContactsToFunnel(p.ctx.organizationId, p.ctx.userId, {
      contactIds: p.ids,
      stageId,
      productServiceId: productServiceId || null,
    });
    if (!res) return { ok: false, error: "invalid" };
    await audit(p.ctx, { action: "contacts.toFunnel", entity: "contacts", meta: { stageId, ...res } });
    revalidatePath("/app/crm");
    return { ok: true, ...res };
  } catch (error) {
    console.error("bulkSendContactsToFunnel failed", error);
    return { ok: false, error: "unknown" };
  }
}

// ── Companies ────────────────────────────────────────────────────────────────

export async function bulkDeleteCompanies(ids: string[]): Promise<BulkResult> {
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  try {
    const db = tenantDb(p.ctx.organizationId);
    const res = await db.company.deleteMany({ where: { id: { in: p.ids } } });
    revalidatePath("/app/companies");
    return { ok: true, count: res.count };
  } catch (error) {
    console.error("bulkDeleteCompanies failed", error);
    return { ok: false, error: "unknown" };
  }
}

export async function bulkMoveCompanies(ids: string[], folderId: string | null): Promise<BulkResult> {
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  try {
    const db = tenantDb(p.ctx.organizationId);
    if (folderId) {
      const folder = await db.companyFolder.findFirst({ where: { id: folderId }, select: { id: true } });
      if (!folder) return { ok: false, error: "invalid" };
    }
    const res = await db.company.updateMany({ where: { id: { in: p.ids } }, data: { folderId } });
    revalidatePath("/app/companies");
    return { ok: true, count: res.count };
  } catch (error) {
    console.error("bulkMoveCompanies failed", error);
    return { ok: false, error: "unknown" };
  }
}
