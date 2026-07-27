"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Merge duplicate records. The primary is kept and enriched with the losers'
 * data where it was blank; every relation pointing at a loser is repointed to
 * the primary; then the losers are deleted.
 *
 * All of it runs in one transaction, so a mid-merge failure can't leave records
 * half-repointed (some deals moved, contact still around).
 */

export type MergeResult =
  | { ok: true }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

/** First non-empty value across primary then losers (primary wins). */
function coalesce(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const s = (v ?? "").toString().trim();
    if (s) return s;
  }
  return null;
}

export async function mergeContacts(primaryId: string, loserIds: string[]): Promise<MergeResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const losers = [...new Set(loserIds.filter((id) => id && id !== primaryId))];
  if (!primaryId || losers.length === 0) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    // All must belong to this org (tenantDb scopes the read).
    const all = await db.contact.findMany({
      where: { id: { in: [primaryId, ...losers] } },
      select: { id: true, email: true, phone: true, role: true, companyId: true, tags: true },
    });
    const primary = all.find((c) => c.id === primaryId);
    const others = all.filter((c) => c.id !== primaryId);
    if (!primary || others.length === 0) return { ok: false, error: "invalid" };

    const tags = [...new Set([...primary.tags, ...others.flatMap((o) => o.tags)])].slice(0, 30);

    await db.$transaction(async (tx) => {
      // CampaignRecipient is unique on (campaignId, contactId): drop a loser's
      // recipient rows for campaigns the primary is already in, then repoint the
      // rest. Otherwise the update would violate the constraint.
      const primaryCampaigns = (
        await tx.campaignRecipient.findMany({ where: { contactId: primaryId }, select: { campaignId: true } })
      ).map((r) => r.campaignId);
      if (primaryCampaigns.length) {
        await tx.campaignRecipient.deleteMany({
          where: { contactId: { in: losers }, campaignId: { in: primaryCampaigns } },
        });
      }
      await tx.campaignRecipient.updateMany({ where: { contactId: { in: losers } }, data: { contactId: primaryId } });

      // Plain repoints (no unique constraints on these).
      await tx.opportunity.updateMany({ where: { contactId: { in: losers } }, data: { contactId: primaryId } });
      await tx.proposal.updateMany({ where: { contactId: { in: losers } }, data: { contactId: primaryId } });
      await tx.conversation.updateMany({ where: { contactId: { in: losers } }, data: { contactId: primaryId } });
      await tx.financeEntry.updateMany({ where: { contactId: { in: losers } }, data: { contactId: primaryId } });
      await tx.task.updateMany({ where: { contactId: { in: losers } }, data: { contactId: primaryId } });

      await tx.contact.update({
        where: { id: primaryId },
        data: {
          email: coalesce(primary.email, ...others.map((o) => o.email)),
          phone: coalesce(primary.phone, ...others.map((o) => o.phone)),
          role: coalesce(primary.role, ...others.map((o) => o.role)),
          companyId: primary.companyId ?? others.find((o) => o.companyId)?.companyId ?? null,
          tags,
        },
      });
      await tx.contact.deleteMany({ where: { id: { in: losers } } });
    });

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
  const losers = [...new Set(loserIds.filter((id) => id && id !== primaryId))];
  if (!primaryId || losers.length === 0) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const all = await db.company.findMany({
      where: { id: { in: [primaryId, ...losers] } },
      select: { id: true, cnpj: true, email: true, phone: true, website: true, notes: true, address: true },
    });
    const primary = all.find((c) => c.id === primaryId);
    const others = all.filter((c) => c.id !== primaryId);
    if (!primary || others.length === 0) return { ok: false, error: "invalid" };

    const primaryAddr = primary.address as Record<string, unknown> | null;
    const addrFilled = primaryAddr && Object.keys(primaryAddr).length > 0;

    await db.$transaction(async (tx) => {
      await tx.contact.updateMany({ where: { companyId: { in: losers } }, data: { companyId: primaryId } });
      await tx.opportunity.updateMany({ where: { companyId: { in: losers } }, data: { companyId: primaryId } });
      await tx.proposal.updateMany({ where: { companyId: { in: losers } }, data: { companyId: primaryId } });
      await tx.financeEntry.updateMany({ where: { companyId: { in: losers } }, data: { companyId: primaryId } });
      await tx.task.updateMany({ where: { companyId: { in: losers } }, data: { companyId: primaryId } });

      await tx.company.update({
        where: { id: primaryId },
        data: {
          cnpj: coalesce(primary.cnpj, ...others.map((o) => o.cnpj)),
          email: coalesce(primary.email, ...others.map((o) => o.email)),
          phone: coalesce(primary.phone, ...others.map((o) => o.phone)),
          website: coalesce(primary.website, ...others.map((o) => o.website)),
          notes: coalesce(primary.notes, ...others.map((o) => o.notes)),
          // Keep the primary's address if it has one; else adopt a loser's.
          address: addrFilled
            ? (primary.address ?? {})
            : (others.find((o) => o.address && Object.keys(o.address).length > 0)?.address ?? {}),
        },
      });
      await tx.company.deleteMany({ where: { id: { in: losers } } });
    });

    revalidatePath("/app/companies");
    return { ok: true };
  } catch (error) {
    console.error("mergeCompanies failed", error);
    return { ok: false, error: "unknown" };
  }
}
