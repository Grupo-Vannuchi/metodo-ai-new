import "server-only";
import { tenantDb } from "@/lib/tenant-db";

export type TimelineType =
  | "created"
  | "proposal"
  | "task"
  | "task_done"
  | "attachment"
  | "won"
  | "lost"
  | "canceled";

export type TimelineEvent = {
  key: string;
  type: TimelineType;
  /** ISO timestamp. */
  at: string;
  title: string | null;
};

/**
 * Activity history for an opportunity, aggregated from what already exists
 * (creation, proposals, tasks, attachments, close) — no separate event log.
 * Newest first.
 */
export async function getOpportunityTimeline(
  organizationId: string,
  opportunityId: string,
): Promise<TimelineEvent[]> {
  const db = tenantDb(organizationId);

  const opp = await db.opportunity.findFirst({
    where: { id: opportunityId },
    select: { createdAt: true, closedAt: true, status: true, outcomeReason: true },
  });
  if (!opp) return [];

  const [proposals, tasks, attachments] = await Promise.all([
    db.proposal.findMany({
      where: { opportunityId },
      select: { id: true, code: true, title: true, createdAt: true },
    }),
    db.task.findMany({
      where: { opportunityId },
      select: { id: true, title: true, createdAt: true, doneAt: true },
    }),
    db.opportunityAttachment.findMany({
      where: { opportunityId },
      select: { id: true, name: true, createdAt: true },
    }),
  ]);

  const events: TimelineEvent[] = [{ key: "created", type: "created", at: opp.createdAt.toISOString(), title: null }];

  for (const p of proposals) {
    events.push({ key: `prop-${p.id}`, type: "proposal", at: p.createdAt.toISOString(), title: p.code || p.title });
  }
  for (const t of tasks) {
    events.push({ key: `task-${t.id}`, type: "task", at: t.createdAt.toISOString(), title: t.title });
    if (t.doneAt) {
      events.push({ key: `task-done-${t.id}`, type: "task_done", at: t.doneAt.toISOString(), title: t.title });
    }
  }
  for (const a of attachments) {
    events.push({ key: `att-${a.id}`, type: "attachment", at: a.createdAt.toISOString(), title: a.name });
  }
  if (opp.closedAt && (opp.status === "WON" || opp.status === "LOST" || opp.status === "CANCELED")) {
    const type = opp.status.toLowerCase() as "won" | "lost" | "canceled";
    events.push({ key: "closed", type, at: opp.closedAt.toISOString(), title: opp.outcomeReason || null });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}
