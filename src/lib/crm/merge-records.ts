import "server-only";
import type { tenantDb } from "@/lib/tenant-db";
import { mergeContactFolderLinks } from "@/lib/crm/contact-folder-links";

/**
 * Duplicate merge (the "Mesclar duplicados" window of contacts and companies). The primary is kept and
 * filled with the losers' data where it is blank; every row that points at a loser is repointed to the
 * primary; then the losers are deleted. All of it runs in one transaction, so a failure halfway leaves
 * nothing half-moved.
 *
 * Every table that keeps a live link to a contact or a company is repointed here. Left alone on purpose:
 * the history tables that keep their own copy of the name, e-mail or phone (AuditLog, FeedPostAttachment,
 * EmailBroadcastRecipient, WhatsappGroupAddItem). **A new table with a `contactId` or `companyId` must be
 * added here**, or a merge leaves it pointing at a deleted record (no foreign key stops the delete).
 *
 * `db` is `tenantDb(orgId)`: every read and write is filtered by the organization, and only the ids that
 * the first read proved to be of this organization are touched.
 */

type Db = ReturnType<typeof tenantDb>;

export type MergeOutcome = "ok" | "invalid";

/** First non-empty value across primary then losers (primary wins). */
function coalesce(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const s = (v ?? "").toString().trim();
    if (s) return s;
  }
  return null;
}

/** The loser ids as sent by the client: strings only, no repeats, never the primary. */
function cleanLosers(primaryId: unknown, loserIds: unknown): { primaryId: string; losers: string[] } | null {
  if (typeof primaryId !== "string" || !primaryId || !Array.isArray(loserIds)) return null;
  const losers = [...new Set(loserIds.filter((id): id is string => typeof id === "string" && !!id && id !== primaryId))];
  return losers.length ? { primaryId, losers } : null;
}

/**
 * For a table that allows one row per (key, record): a loser row whose key the primary already has, or
 * that an earlier loser row already took, is deleted; the rest are repointed. Rows come in a stable order,
 * so the oldest one of each key is the one kept.
 */
function onePerKey(primaryKeys: readonly string[], loserRows: readonly { id: string; key: string }[]) {
  const taken = new Set(primaryKeys);
  const deleteIds: string[] = [];
  const repointIds: string[] = [];
  for (const row of loserRows) {
    if (taken.has(row.key)) {
      deleteIds.push(row.id);
    } else {
      taken.add(row.key);
      repointIds.push(row.id);
    }
  }
  return { deleteIds, repointIds };
}

/** Pins are unique per (user, type, record): a user ends up with one pin on the primary at most. */
async function mergePins(
  tx: Pick<Db, "pinnedItem">,
  entityType: "CONTACT" | "COMPANY",
  primaryId: string,
  loserIds: readonly string[],
): Promise<void> {
  const primaryUsers = (
    await tx.pinnedItem.findMany({ where: { entityType, entityId: primaryId }, select: { userId: true } })
  ).map((p) => p.userId);
  const loserPins = await tx.pinnedItem.findMany({
    where: { entityType, entityId: { in: [...loserIds] } },
    select: { id: true, userId: true },
    orderBy: { id: "asc" },
  });
  const { deleteIds, repointIds } = onePerKey(
    primaryUsers,
    loserPins.map((p) => ({ id: p.id, key: p.userId })),
  );
  if (deleteIds.length) await tx.pinnedItem.deleteMany({ where: { id: { in: deleteIds } } });
  if (repointIds.length) {
    await tx.pinnedItem.updateMany({ where: { id: { in: repointIds } }, data: { entityId: primaryId } });
  }
}

export async function mergeContactRecords(db: Db, primaryIdIn: unknown, loserIdsIn: unknown): Promise<MergeOutcome> {
  const input = cleanLosers(primaryIdIn, loserIdsIn);
  if (!input) return "invalid";
  const { primaryId, losers } = input;

  const all = await db.contact.findMany({
    where: { id: { in: [primaryId, ...losers] } },
    select: { id: true, email: true, phone: true, role: true, companyId: true, tags: true, optedOut: true },
  });
  const primary = all.find((c) => c.id === primaryId);
  const others = all.filter((c) => c.id !== primaryId);
  if (!primary || others.length === 0) return "invalid";
  const ids = others.map((o) => o.id);

  const tags = [...new Set([...primary.tags, ...others.flatMap((o) => o.tags)])].slice(0, 30);

  await db.$transaction(async (tx) => {
    // CampaignRecipient is unique on (campaignId, contactId): one row per campaign survives (the primary's,
    // else the oldest loser's); the rest are dropped before the repoint, or it would break the constraint.
    const primaryCampaigns = (
      await tx.campaignRecipient.findMany({ where: { contactId: primaryId }, select: { campaignId: true } })
    ).map((r) => r.campaignId);
    const loserRecipients = await tx.campaignRecipient.findMany({
      where: { contactId: { in: ids } },
      select: { id: true, campaignId: true },
      orderBy: { id: "asc" },
    });
    const recipients = onePerKey(
      primaryCampaigns,
      loserRecipients.map((r) => ({ id: r.id, key: r.campaignId })),
    );
    if (recipients.deleteIds.length) {
      await tx.campaignRecipient.deleteMany({ where: { id: { in: recipients.deleteIds } } });
    }
    if (recipients.repointIds.length) {
      await tx.campaignRecipient.updateMany({
        where: { id: { in: recipients.repointIds } },
        data: { contactId: primaryId },
      });
    }

    // Plain repoints (no unique constraint on contactId in these).
    await tx.opportunity.updateMany({ where: { contactId: { in: ids } }, data: { contactId: primaryId } });
    await tx.proposal.updateMany({ where: { contactId: { in: ids } }, data: { contactId: primaryId } });
    await tx.conversation.updateMany({ where: { contactId: { in: ids } }, data: { contactId: primaryId } });
    await tx.whatsappCloudConversation.updateMany({
      where: { contactId: { in: ids } },
      data: { contactId: primaryId },
    });
    await tx.financeEntry.updateMany({ where: { contactId: { in: ids } }, data: { contactId: primaryId } });
    await tx.task.updateMany({ where: { contactId: { in: ids } }, data: { contactId: primaryId } });
    await mergePins(tx, "CONTACT", primaryId, ids);

    const res = await tx.contact.updateMany({
      where: { id: primaryId },
      data: {
        email: coalesce(primary.email, ...others.map((o) => o.email)),
        phone: coalesce(primary.phone, ...others.map((o) => o.phone)),
        role: coalesce(primary.role, ...others.map((o) => o.role)),
        companyId: primary.companyId ?? others.find((o) => o.companyId)?.companyId ?? null,
        tags,
        // LGPD: if any of them asked to leave the campaigns, the merged contact stays out.
        optedOut: primary.optedOut || others.some((o) => o.optedOut),
      },
    });
    if (res.count === 0) throw new Error("merge: the primary contact is not in this organization");
    // Before the delete: the losers' folder links would cascade away with them.
    await mergeContactFolderLinks(tx, primaryId, ids);
    await tx.contact.deleteMany({ where: { id: { in: ids } } });
  });

  return "ok";
}

export async function mergeCompanyRecords(db: Db, primaryIdIn: unknown, loserIdsIn: unknown): Promise<MergeOutcome> {
  const input = cleanLosers(primaryIdIn, loserIdsIn);
  if (!input) return "invalid";
  const { primaryId, losers } = input;

  const all = await db.company.findMany({
    where: { id: { in: [primaryId, ...losers] } },
    select: { id: true, cnpj: true, email: true, phone: true, website: true, notes: true, address: true },
  });
  const primary = all.find((c) => c.id === primaryId);
  const others = all.filter((c) => c.id !== primaryId);
  if (!primary || others.length === 0) return "invalid";
  const ids = others.map((o) => o.id);

  const primaryAddr = primary.address as Record<string, unknown> | null;
  const addrFilled = primaryAddr && Object.keys(primaryAddr).length > 0;

  await db.$transaction(async (tx) => {
    await tx.contact.updateMany({ where: { companyId: { in: ids } }, data: { companyId: primaryId } });
    await tx.opportunity.updateMany({ where: { companyId: { in: ids } }, data: { companyId: primaryId } });
    await tx.proposal.updateMany({ where: { companyId: { in: ids } }, data: { companyId: primaryId } });
    await tx.financeEntry.updateMany({ where: { companyId: { in: ids } }, data: { companyId: primaryId } });
    await tx.task.updateMany({ where: { companyId: { in: ids } }, data: { companyId: primaryId } });
    await tx.serviceTicket.updateMany({ where: { companyId: { in: ids } }, data: { companyId: primaryId } });
    await tx.asset.updateMany({ where: { ownerCompanyId: { in: ids } }, data: { ownerCompanyId: primaryId } });
    await tx.extractedLead.updateMany({
      where: { importedCompanyId: { in: ids } },
      data: { importedCompanyId: primaryId },
    });
    await mergePins(tx, "COMPANY", primaryId, ids);

    const res = await tx.company.updateMany({
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
    if (res.count === 0) throw new Error("merge: the primary company is not in this organization");
    await tx.company.deleteMany({ where: { id: { in: ids } } });
  });

  return "ok";
}
