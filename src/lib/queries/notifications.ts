import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { taskCounts, tasksAssignedByOthers, type AssignedAlert } from "@/lib/queries/tasks";
import { countUnread } from "@/lib/queries/inbox";

const STALE_DAYS = 7;

export type Alerts = {
  total: number;
  tasksOverdue: number;
  tasksToday: number;
  staleOpps: number;
  financeOverdue: number;
  unread: number;
  assigned: AssignedAlert[];
};

/** Derived (computed) alerts for the notification bell — no persisted table.
 * Surfaces overdue/today tasks, stale open deals, overdue finance and unread
 * conversations for the signed-in user. */
export async function getAlerts(
  organizationId: string,
  userId: string,
  hasFinance: boolean,
): Promise<Alerts> {
  const db = tenantDb(organizationId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const staleBefore = new Date();
  staleBefore.setDate(staleBefore.getDate() - STALE_DAYS);

  const [tasks, staleOpps, financeOverdue, unread, assigned] = await Promise.all([
    taskCounts(organizationId, userId),
    db.opportunity.count({
      where: { status: "OPEN", ownerId: userId, updatedAt: { lt: staleBefore } },
    }),
    hasFinance
      ? db.financeEntry.count({ where: { status: "PENDING", dueDate: { lt: today } } })
      : Promise.resolve(0),
    countUnread(organizationId),
    tasksAssignedByOthers(organizationId, userId),
  ]);

  const total = tasks.overdue + tasks.today + staleOpps + financeOverdue + unread + assigned.length;
  return {
    total,
    tasksOverdue: tasks.overdue,
    tasksToday: tasks.today,
    staleOpps,
    financeOverdue,
    unread,
    assigned,
  };
}
