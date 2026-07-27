import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { listTeamMembers } from "@/lib/queries/team-chat";

export type GoalRow = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  target: number;
  achieved: number;
};

/** Current month as "YYYY-MM". */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

/**
 * Each member's monthly target vs. what they've actually won that month.
 * "Achieved" = Σ value of WON opportunities they own that closed in the month.
 */
export async function getGoals(organizationId: string, month: string): Promise<GoalRow[]> {
  const db = tenantDb(organizationId);
  const { start, end } = monthRange(month);

  const [members, goals, won] = await Promise.all([
    listTeamMembers(organizationId),
    db.goal.findMany({ where: { month }, select: { userId: true, targetValue: true } }),
    db.opportunity.groupBy({
      by: ["ownerId"],
      where: { status: "WON", ownerId: { not: null }, updatedAt: { gte: start, lt: end } },
      _sum: { value: true },
    }),
  ]);

  const targetByUser = new Map(goals.map((g) => [g.userId, Number(g.targetValue)]));
  const wonByUser = new Map(won.map((w) => [w.ownerId as string, Number(w._sum.value ?? 0)]));

  return members.map((m) => ({
    userId: m.userId,
    name: m.name,
    avatarUrl: m.avatarUrl,
    target: targetByUser.get(m.userId) ?? 0,
    achieved: wonByUser.get(m.userId) ?? 0,
  }));
}
