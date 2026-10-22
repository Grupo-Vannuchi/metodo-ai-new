import "server-only";
import type { Prisma, TaskPriority, TaskStatus, TaskType } from "@prisma/client";
import type { Period } from "@/lib/mcp/core";
import { userNames } from "@/lib/queries/mcp/shared";
import { saoPauloDayStart } from "@/lib/tasks/board-core";
import { tenantDb } from "@/lib/tenant-db";

/**
 * Tasks reads of the MCP server. "Overdue" is the Tasks screen's rule: still
 * open and due before today in São Paulo. The free-text description never
 * leaves.
 */

type Page = { take: number; skip: number };
type Range = { gte?: Date; lt?: Date } | null;

const overdueWhere = (dayStart: Date): Prisma.TaskWhereInput => ({ doneAt: null, dueDate: { lt: dayStart } });
const uniqueIds = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))];

export async function searchTasks(
  organizationId: string,
  a: {
    status?: TaskStatus;
    priority?: TaskPriority;
    type?: TaskType;
    assignedToId?: string;
    overdue?: boolean;
    search?: string;
    range: Range;
    page: Page;
  },
  now: Date,
) {
  const db = tenantDb(organizationId);
  const dayStart = saoPauloDayStart(now);
  // The overdue rule and the period both filter dueDate, so they go in AND, not side by side.
  const and: Prisma.TaskWhereInput[] = [];
  if (a.overdue === true) and.push(overdueWhere(dayStart));
  if (a.overdue === false) and.push({ NOT: overdueWhere(dayStart) });
  if (a.range) and.push({ dueDate: a.range });
  const where: Prisma.TaskWhereInput = {
    status: a.status,
    priority: a.priority,
    type: a.type,
    assignedToId: a.assignedToId,
    ...(a.search ? { title: { contains: a.search, mode: "insensitive" } } : {}),
    ...(and.length ? { AND: and } : {}),
  };
  const [total, rows] = await Promise.all([
    db.task.count({ where }),
    db.task.findMany({
      where,
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      ...a.page,
      select: {
        id: true,
        title: true,
        type: true,
        priority: true,
        status: true,
        progress: true,
        startDate: true,
        dueDate: true,
        doneAt: true,
        assignedToId: true,
        companyId: true,
        contactId: true,
        opportunityId: true,
        createdAt: true,
      },
    }),
  ]);

  // CRM links are bare ids on Task; names resolved on read.
  const companyIds = uniqueIds(rows.map((t) => t.companyId));
  const contactIds = uniqueIds(rows.map((t) => t.contactId));
  const opportunityIds = uniqueIds(rows.map((t) => t.opportunityId));
  const [assignees, companies, contacts, opportunities] = await Promise.all([
    userNames(rows.map((t) => t.assignedToId)),
    companyIds.length
      ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    contactIds.length
      ? db.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    opportunityIds.length
      ? db.opportunity.findMany({ where: { id: { in: opportunityIds } }, select: { id: true, title: true } })
      : Promise.resolve([]),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  const opportunityTitle = new Map(opportunities.map((o) => [o.id, o.title]));

  return {
    total,
    items: rows.map(({ companyId, contactId, opportunityId, ...t }) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      priority: t.priority,
      status: t.status,
      progress: t.progress,
      startDate: t.startDate,
      dueDate: t.dueDate,
      doneAt: t.doneAt,
      overdue: t.doneAt === null && t.dueDate !== null && t.dueDate < dayStart,
      assignedToId: t.assignedToId,
      assigneeName: t.assignedToId ? (assignees.get(t.assignedToId) ?? null) : null,
      companyName: companyId ? (companyName.get(companyId) ?? null) : null,
      contactName: contactId ? (contactName.get(contactId) ?? null) : null,
      opportunityTitle: opportunityId ? (opportunityTitle.get(opportunityId) ?? null) : null,
      createdAt: t.createdAt,
    })),
  };
}

/** Open and overdue now, created and done in the period — overall and per assignee. */
export async function tasksSummary(organizationId: string, period: Period, now: Date) {
  const db = tenantDb(organizationId);
  const inPeriod = { gte: period.gte, lt: period.lt };
  const overdue = overdueWhere(saoPauloDayStart(now));
  const assigned: Prisma.TaskWhereInput = { assignedToId: { not: null } };

  const [openByStatus, overdueCount, createdInPeriod, doneInPeriod, openBy, overdueBy, doneBy] = await Promise.all([
    db.task.groupBy({ by: ["status"], where: { doneAt: null }, _count: { _all: true } }),
    db.task.count({ where: overdue }),
    db.task.count({ where: { createdAt: inPeriod } }),
    db.task.count({ where: { doneAt: inPeriod } }),
    db.task.groupBy({ by: ["assignedToId"], where: { doneAt: null, ...assigned }, _count: { _all: true } }),
    db.task.groupBy({ by: ["assignedToId"], where: { ...overdue, ...assigned }, _count: { _all: true } }),
    db.task.groupBy({ by: ["assignedToId"], where: { doneAt: inPeriod, ...assigned }, _count: { _all: true } }),
  ]);

  const perUser = new Map<string, { open: number; overdue: number; doneInPeriod: number }>();
  const row = (userId: string) => {
    let r = perUser.get(userId);
    if (!r) {
      r = { open: 0, overdue: 0, doneInPeriod: 0 };
      perUser.set(userId, r);
    }
    return r;
  };
  for (const g of openBy) row(g.assignedToId as string).open = g._count._all;
  for (const g of overdueBy) row(g.assignedToId as string).overdue = g._count._all;
  for (const g of doneBy) row(g.assignedToId as string).doneInPeriod = g._count._all;
  const names = await userNames([...perUser.keys()]);
  const openOf = (status: TaskStatus) => openByStatus.find((g) => g.status === status)?._count._all ?? 0;

  return {
    period: { from: period.from, to: period.to },
    open: { todo: openOf("TODO"), inProgress: openOf("IN_PROGRESS") },
    overdue: overdueCount,
    createdInPeriod,
    doneInPeriod,
    byAssignee: [...perUser]
      .map(([userId, r]) => ({ userId, userName: names.get(userId) ?? null, ...r }))
      .sort((x, y) => y.open - x.open),
  };
}
