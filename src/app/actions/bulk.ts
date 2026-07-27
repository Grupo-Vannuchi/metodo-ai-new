"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

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

export async function bulkMoveContacts(ids: string[], folderId: string | null): Promise<BulkResult> {
  const p = await prep(ids);
  if ("error" in p) return { ok: false, error: p.error };
  try {
    const db = tenantDb(p.ctx.organizationId);
    if (folderId) {
      const folder = await db.contactFolder.findFirst({ where: { id: folderId }, select: { id: true } });
      if (!folder) return { ok: false, error: "invalid" };
    }
    const res = await db.contact.updateMany({ where: { id: { in: p.ids } }, data: { folderId } });
    revalidatePath("/app/contacts");
    return { ok: true, count: res.count };
  } catch (error) {
    console.error("bulkMoveContacts failed", error);
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
