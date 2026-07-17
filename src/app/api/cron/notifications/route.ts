import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { getAlerts } from "@/lib/queries/notifications";
import { hrAlertCounts } from "@/lib/queries/time-off";
import { hasFeature, type PlanKey } from "@/config/plans";
import { DIGEST_KINDS } from "@/lib/notifications";

export const runtime = "nodejs";

/**
 * Daily digest cron (Vercel Cron — see vercel.json). For every membership it
 * recomputes the pending counts and refreshes the persisted SYSTEM digest
 * notifications. Idempotent: unread digest notifications are dropped and
 * recreated, so re-runs never pile up. Assignment notifications are created
 * by the actions, never here.
 *
 * Protected by CRON_SECRET (Vercel sends it as `Authorization: Bearer …`).
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const memberships = await prisma.membership.findMany({
    select: {
      organizationId: true,
      userId: true,
      role: true,
      organization: { select: { plan: true } },
    },
  });

  // HR counters are org-level: compute once per org, not once per member.
  const hrByOrg = new Map<string, Awaited<ReturnType<typeof hrAlertCounts>>>();

  let processed = 0;
  for (const m of memberships) {
    const plan = m.organization.plan as PlanKey;
    const hasFinance = hasFeature(plan, "finance");
    const alerts = await getAlerts(m.organizationId, m.userId, hasFinance);
    const db = tenantDb(m.organizationId);

    await db.notification.deleteMany({
      where: { userId: m.userId, type: { in: [...DIGEST_KINDS] }, readAt: null },
    });

    const rows = [
      { type: "TASK_OVERDUE", count: alerts.tasksOverdue, link: "/app/tasks" },
      { type: "TASK_TODAY", count: alerts.tasksToday, link: "/app/tasks" },
      { type: "TASK_REMINDER", count: alerts.tasksReminder, link: "/app/tasks" },
      { type: "OPP_STALE", count: alerts.staleOpps, link: "/app/crm" },
      { type: "FINANCE_OVERDUE", count: alerts.financeOverdue, link: "/app/finance/entries" },
      { type: "INBOX_UNREAD", count: alerts.unread, link: "/app/inbox" },
    ].filter((r) => r.count > 0);

    // HR digests go only to the managers (payroll/HR data is sensitive).
    const isManager = m.role === "OWNER" || m.role === "ADMIN";
    if (isManager && hasFeature(plan, "hr")) {
      if (!hrByOrg.has(m.organizationId)) {
        hrByOrg.set(m.organizationId, await hrAlertCounts(m.organizationId));
      }
      const hr = hrByOrg.get(m.organizationId)!;
      rows.push(
        ...[
          { type: "HR_TIMEOFF_PENDING", count: hr.timeOffPending, link: "/app/hr/timeoff" },
          { type: "HR_BIRTHDAY_TODAY", count: hr.birthdaysToday, link: "/app/hr" },
          { type: "HR_PROBATION_ENDING", count: hr.probationEnding, link: "/app/hr" },
          { type: "HR_DOCS_EXPIRING", count: hr.docsExpiring, link: "/app/hr" },
        ].filter((r) => r.count > 0),
      );
    }

    if (rows.length > 0) {
      await db.notification.createMany({
        data: rows.map((r) => ({
          organizationId: m.organizationId,
          userId: m.userId,
          type: r.type,
          data: { count: r.count },
          link: r.link,
        })),
      });
      processed += rows.length;
    }
  }

  return Response.json({ ok: true, processed });
}
