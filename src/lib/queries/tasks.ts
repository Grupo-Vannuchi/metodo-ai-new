import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";

export type TaskScope = "all" | "open" | "today" | "overdue" | "upcoming" | "done";

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  dueDate: Date | null;
  doneAt: Date | null;
  assignedToId: string | null;
  assignedToName: string | null;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfTomorrow() {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

function scopeWhere(scope: TaskScope): Prisma.TaskWhereInput {
  const today = startOfToday();
  const tomorrow = startOfTomorrow();
  switch (scope) {
    case "done":
      return { doneAt: { not: null } };
    case "open":
      return { doneAt: null };
    case "overdue":
      return { doneAt: null, dueDate: { lt: today } };
    case "today":
      return { doneAt: null, dueDate: { gte: today, lt: tomorrow } };
    case "upcoming":
      return { doneAt: null, dueDate: { gte: tomorrow } };
    default:
      return {};
  }
}

export async function listTasks(
  organizationId: string,
  opts: {
    scope?: TaskScope;
    assignedToId?: string;
    contactId?: string;
    opportunityId?: string;
  } = {},
): Promise<TaskRow[]> {
  const db = tenantDb(organizationId);
  const where: Prisma.TaskWhereInput = { ...scopeWhere(opts.scope ?? "all") };
  if (opts.assignedToId) where.assignedToId = opts.assignedToId;
  if (opts.contactId) where.contactId = opts.contactId;
  if (opts.opportunityId) where.opportunityId = opts.opportunityId;

  const tasks = await db.task.findMany({
    where,
    orderBy: [{ doneAt: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      priority: true,
      dueDate: true,
      doneAt: true,
      assignedToId: true,
      contactId: true,
      companyId: true,
      opportunityId: true,
    },
  });

  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean))] as string[];
  const userIds = uniq(tasks.map((t) => t.assignedToId));
  const contactIds = uniq(tasks.map((t) => t.contactId));
  const oppIds = uniq(tasks.map((t) => t.opportunityId));

  const [users, contacts, opps] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [],
    contactIds.length
      ? db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
      : [],
    oppIds.length
      ? db.opportunity.findMany({ where: { id: { in: oppIds } }, select: { id: true, title: true } })
      : [],
  ]);
  const uMap = new Map(users.map((u) => [u.id, u.name]));
  const cMap = new Map(contacts.map((c) => [c.id, c.name]));
  const oMap = new Map(opps.map((o) => [o.id, o.title]));

  return tasks.map((t) => ({
    ...t,
    assignedToName: t.assignedToId ? uMap.get(t.assignedToId) ?? null : null,
    contactName: t.contactId ? cMap.get(t.contactId) ?? null : null,
    opportunityTitle: t.opportunityId ? oMap.get(t.opportunityId) ?? null : null,
  }));
}

/** Open-task counters for a user (nav badge + notifications). */
export async function taskCounts(
  organizationId: string,
  userId: string,
): Promise<{ overdue: number; today: number; open: number }> {
  const db = tenantDb(organizationId);
  const today = startOfToday();
  const tomorrow = startOfTomorrow();
  const [overdue, todayCount, open] = await Promise.all([
    db.task.count({ where: { assignedToId: userId, doneAt: null, dueDate: { lt: today } } }),
    db.task.count({ where: { assignedToId: userId, doneAt: null, dueDate: { gte: today, lt: tomorrow } } }),
    db.task.count({ where: { assignedToId: userId, doneAt: null } }),
  ]);
  return { overdue, today: todayCount, open };
}

/** A single task with resolved names, for the read-only view. */
export async function getTask(organizationId: string, id: string) {
  const db = tenantDb(organizationId);
  const task = await db.task.findFirst({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      priority: true,
      dueDate: true,
      doneAt: true,
      createdAt: true,
      assignedToId: true,
      createdById: true,
      contactId: true,
      companyId: true,
      opportunityId: true,
    },
  });
  if (!task) return null;

  const userIds = [task.assignedToId, task.createdById].filter(Boolean) as string[];
  const [users, contact, company, opp] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [],
    task.contactId ? db.contact.findFirst({ where: { id: task.contactId }, select: { name: true } }) : null,
    task.companyId ? db.company.findFirst({ where: { id: task.companyId }, select: { name: true } }) : null,
    task.opportunityId
      ? db.opportunity.findFirst({ where: { id: task.opportunityId }, select: { title: true, code: true } })
      : null,
  ]);
  const uMap = new Map(users.map((u) => [u.id, u.name]));
  const done = task.doneAt != null;

  return {
    ...task,
    done,
    overdue: !done && task.dueDate != null && task.dueDate.getTime() < Date.now(),
    assignedToName: task.assignedToId ? uMap.get(task.assignedToId) ?? null : null,
    createdByName: task.createdById ? uMap.get(task.createdById) ?? null : null,
    contactName: contact?.name ?? null,
    companyName: company?.name ?? null,
    opportunityTitle: opp?.title ?? null,
    opportunityCode: opp?.code ?? null,
  };
}

