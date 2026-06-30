import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { taskCounts } from "@/lib/queries/tasks";
import { countUnread } from "@/lib/queries/inbox";

const STALE_DAYS = 7;

export type Alerts = {
  tasksOverdue: number;
  tasksToday: number;
  staleOpps: number;
  financeOverdue: number;
  unread: number;
};

/** Pending-item counts for a member, used by the digest cron to build the
 * persisted SYSTEM notifications. Assignment notifications are event-based
 * (created by the actions), so they are not computed here. */
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

  const [tasks, staleOpps, financeOverdue, unread] = await Promise.all([
    taskCounts(organizationId, userId),
    db.opportunity.count({
      where: { status: "OPEN", ownerId: userId, updatedAt: { lt: staleBefore } },
    }),
    hasFinance
      ? db.financeEntry.count({ where: { status: "PENDING", dueDate: { lt: today } } })
      : Promise.resolve(0),
    countUnread(organizationId, { userId, role: "MEMBER" }),
  ]);

  return {
    tasksOverdue: tasks.overdue,
    tasksToday: tasks.today,
    staleOpps,
    financeOverdue,
    unread,
  };
}
