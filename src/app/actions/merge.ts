"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { mergeCompanyRecords, mergeContactRecords } from "@/lib/crm/merge-records";

/**
 * Merge duplicate records (the "Mesclar duplicados" window). The merge itself — what is repointed, what
 * the primary keeps, the single transaction — lives in src/lib/crm/merge-records.ts, so a database check
 * (`npm run check:merge:db`) can run it against the real Postgres.
 */

export type MergeResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

export async function mergeContacts(primaryId: string, loserIds: string[]): Promise<MergeResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  try {
    const outcome = await mergeContactRecords(tenantDb(ctx.organizationId), primaryId, loserIds);
    if (outcome === "invalid") return { ok: false, error: "invalid" };
    revalidatePath("/app/contacts");
    return { ok: true };
  } catch (error) {
    console.error("mergeContacts failed", error);
    return { ok: false, error: "unknown" };
  }
}

export async function mergeCompanies(primaryId: string, loserIds: string[]): Promise<MergeResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  try {
    const outcome = await mergeCompanyRecords(tenantDb(ctx.organizationId), primaryId, loserIds);
    if (outcome === "invalid") return { ok: false, error: "invalid" };
    revalidatePath("/app/companies");
    return { ok: true };
  } catch (error) {
    console.error("mergeCompanies failed", error);
    return { ok: false, error: "unknown" };
  }
}
