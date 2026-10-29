import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import type { GroupAddItemStatus } from "@/lib/whatsapp/group-add/core";

/** Every status an item can have, so a view counts all of them (zero included). */
const ITEM_STATUSES: readonly GroupAddItemStatus[] = [
  "PENDING",
  "PROCESSING",
  "ADDED",
  "INVITED",
  "ALREADY_IN",
  "NO_WHATSAPP",
  "SKIPPED",
  "LEFT_GROUP",
  "ALREADY_INVITED",
  "FAILED",
];

export type GroupAddRunView = {
  id: string;
  groupName: string;
  status: "QUEUED" | "RUNNING" | "PAUSED" | "DONE" | "CANCELED";
  pausedReason: string | null;
  waitReason: string | null;
  nextAttemptAt: Date | null;
  createdById: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  counts: Record<GroupAddItemStatus, number>;
  items: {
    contactId: string;
    contactName: string;
    status: GroupAddItemStatus;
    reason: string | null;
    processedAt: Date | null;
  }[];
};

/** A run with the situation of each contact, in the order of the round. Null when the run is not this organization's. */
export async function getGroupAddRunView(organizationId: string, runId: string): Promise<GroupAddRunView | null> {
  const db = tenantDb(organizationId);
  const run = await db.whatsappGroupAddRun.findFirst({
    where: { id: runId },
    select: {
      id: true,
      groupName: true,
      status: true,
      pausedReason: true,
      waitReason: true,
      nextAttemptAt: true,
      createdById: true,
      startedAt: true,
      finishedAt: true,
    },
  });
  if (!run) return null;
  const items = await db.whatsappGroupAddItem.findMany({
    where: { runId },
    orderBy: { position: "asc" },
    select: { contactId: true, contactName: true, status: true, reason: true, processedAt: true },
  });
  const counts = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<GroupAddItemStatus, number>;
  for (const item of items) counts[item.status]++;
  return { ...run, counts, items };
}

/** The rounds a contact was in, newest first: the register on the contact's page. */
export async function listContactGroupAdds(
  organizationId: string,
  contactId: string,
): Promise<{ runId: string; groupName: string; status: GroupAddItemStatus; processedAt: Date | null; createdById: string }[]> {
  const rows = await tenantDb(organizationId).whatsappGroupAddItem.findMany({
    where: { contactId },
    orderBy: { run: { createdAt: "desc" } },
    select: { runId: true, status: true, processedAt: true, run: { select: { groupName: true, createdById: true } } },
  });
  return rows.map((r) => ({
    runId: r.runId,
    groupName: r.run.groupName,
    status: r.status,
    processedAt: r.processedAt,
    createdById: r.run.createdById,
  }));
}
