"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { deleteMedia } from "@/lib/storage/blob";
import { runAutomations } from "@/lib/automation/engine";
import { taskSchema, checklistTextSchema } from "@/lib/validations/task";

export type TaskResult =
  | { ok: true; id?: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Recurrence = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

async function existsInOrg(
  organizationId: string,
  model: "contact" | "company" | "opportunity",
  id: string | undefined,
): Promise<string | null> {
  if (!id) return null;
  const db = tenantDb(organizationId);
  const found =
    model === "contact"
      ? await db.contact.findFirst({ where: { id }, select: { id: true } })
      : model === "company"
        ? await db.company.findFirst({ where: { id }, select: { id: true } })
        : await db.opportunity.findFirst({ where: { id }, select: { id: true } });
  return found?.id ?? null;
}

/** Resolve the assignee — any org member can be assigned. Falls back to the
 * current assignee/self if the picked user isn't a member of this org. */
async function resolveAssignee(
  organizationId: string,
  userId: string | undefined,
  fallback: string,
): Promise<string> {
  const targetId = userId || fallback;
  if (!targetId) return fallback;
  const m = await prisma.membership.findFirst({
    where: { organizationId, userId: targetId },
    select: { userId: true },
  });
  return m?.userId ?? fallback;
}

const dateOrNull = (s?: string) => (s && s.trim() ? new Date(s) : null);

function parse(formData: FormData) {
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : undefined;
  };
  return taskSchema.safeParse({
    title: str("title"),
    description: str("description"),
    type: str("type") ?? "OTHER",
    priority: str("priority") ?? "MEDIUM",
    status: str("status") ?? "TODO",
    recurrence: str("recurrence") ?? "NONE",
    progress: str("progress"),
    startDate: str("startDate"),
    dueDate: str("dueDate"),
    reminderAt: str("reminderAt"),
    assignedToId: str("assignedToId"),
    contactId: str("contactId"),
    companyId: str("companyId"),
    opportunityId: str("opportunityId"),
  });
}

async function buildData(
  organizationId: string,
  userId: string,
  input: ReturnType<typeof taskSchema.parse>,
  current?: { assignedToId?: string | null; doneAt?: Date | null },
) {
  const fallback = current?.assignedToId || userId;
  const [assignedToId, contactId, companyId, opportunityId] = await Promise.all([
    resolveAssignee(organizationId, input.assignedToId, fallback),
    existsInOrg(organizationId, "contact", input.contactId),
    existsInOrg(organizationId, "company", input.companyId),
    existsInOrg(organizationId, "opportunity", input.opportunityId),
  ]);

  const isDone = input.status === "DONE";
  const doneAt = isDone ? current?.doneAt ?? new Date() : null;
  const progress = isDone ? 100 : clampPct(input.progress ?? 0);

  return {
    title: input.title,
    description: input.description || null,
    type: input.type,
    priority: input.priority,
    status: input.status,
    recurrence: input.recurrence,
    progress,
    startDate: dateOrNull(input.startDate),
    dueDate: dateOrNull(input.dueDate),
    reminderAt: dateOrNull(input.reminderAt),
    doneAt,
    assignedToId,
    contactId,
    companyId,
    opportunityId,
  };
}

function revalidate() {
  revalidatePath("/app/tasks");
  revalidatePath("/app/crm");
  revalidatePath("/app/contacts");
}

/** Advance a date by one recurrence interval (used to spawn the next occurrence). */
function advance(date: Date, rec: Recurrence): Date {
  const d = new Date(date);
  switch (rec) {
    case "DAILY":
      d.setDate(d.getDate() + 1);
      break;
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      break;
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      break;
    case "YEARLY":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

type SpawnSource = {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  recurrence: string;
  startDate: Date | null;
  dueDate: Date | null;
  reminderAt: Date | null;
  assignedToId: string | null;
  createdById: string | null;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
};

/** When a recurring task is completed, create its next occurrence (dates shifted
 * by the interval, checklist reset). Needs a due date to anchor the schedule. */
async function spawnNextOccurrence(db: ReturnType<typeof tenantDb>, task: SpawnSource): Promise<void> {
  const rec = task.recurrence as Recurrence;
  if (rec === "NONE" || !task.dueDate) return;

  const items = await db.taskChecklistItem.findMany({
    where: { taskId: task.id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { text: true, order: true },
  });

  await db.task.create({
    data: {
      organizationId: task.organizationId,
      title: task.title,
      description: task.description,
      type: task.type as never,
      priority: task.priority as never,
      status: "TODO",
      progress: 0,
      recurrence: task.recurrence as never,
      startDate: task.startDate ? advance(task.startDate, rec) : null,
      dueDate: advance(task.dueDate, rec),
      reminderAt: task.reminderAt ? advance(task.reminderAt, rec) : null,
      assignedToId: task.assignedToId,
      createdById: task.createdById,
      contactId: task.contactId,
      companyId: task.companyId,
      opportunityId: task.opportunityId,
      checklist: items.length
        ? { create: items.map((i) => ({ organizationId: task.organizationId, text: i.text, order: i.order, done: false })) }
        : undefined,
    },
  });
}

const SPAWN_SELECT = {
  id: true,
  organizationId: true,
  title: true,
  description: true,
  type: true,
  priority: true,
  recurrence: true,
  startDate: true,
  dueDate: true,
  reminderAt: true,
  assignedToId: true,
  createdById: true,
  contactId: true,
  companyId: true,
  opportunityId: true,
} as const;

async function notifyAssignee(
  db: ReturnType<typeof tenantDb>,
  organizationId: string,
  assignedToId: string,
  actor: string,
  title: string,
  taskId: string,
): Promise<void> {
  await db.notification.create({
    data: {
      organizationId,
      userId: assignedToId,
      type: "TASK_ASSIGNED",
      data: { actor, title },
      link: `/app/tasks/${taskId}`,
    },
  });
}

export async function createTask(formData: FormData): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const data = await buildData(ctx.organizationId, ctx.userId, parsed.data);
    const task = await db.task.create({
      data: { organizationId: ctx.organizationId, createdById: ctx.userId, ...data },
      select: { id: true },
    });
    if (data.assignedToId && data.assignedToId !== ctx.userId) {
      await notifyAssignee(db, ctx.organizationId, data.assignedToId, ctx.user.name, data.title, task.id);
    }
    await audit(ctx, { action: "task.created", entity: "Task", entityId: task.id });
    revalidate();
    return { ok: true, id: task.id };
  } catch (error) {
    console.error("Failed to create task", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateTask(id: string, formData: FormData): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const current = await db.task.findFirst({ where: { id }, select: { doneAt: true, ...SPAWN_SELECT } });
    if (!current) return { ok: false, error: "invalid" };

    const wasDone = current.doneAt != null;
    const data = await buildData(ctx.organizationId, ctx.userId, parsed.data, { assignedToId: current.assignedToId, doneAt: current.doneAt });
    await db.task.updateMany({ where: { id }, data });

    // Completing a recurring task via the form spawns the next occurrence.
    if (!wasDone && data.status === "DONE") await spawnNextOccurrence(db, current);
    if (!wasDone && data.status === "DONE" && current.opportunityId) {
      await runAutomations(ctx.organizationId, { type: "task_completed", opportunityId: current.opportunityId }, ctx.user.name);
    }

    if (data.assignedToId && data.assignedToId !== current.assignedToId && data.assignedToId !== ctx.userId) {
      await notifyAssignee(db, ctx.organizationId, data.assignedToId, ctx.user.name, data.title, id);
    }
    await audit(ctx, { action: "task.updated", entity: "Task", entityId: id });
    revalidate();
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update task", error);
    return { ok: false, error: "unknown" };
  }
}

/** Toggle completion (checkbox / board). Completing a recurring task spawns the
 * next occurrence. */
export async function toggleTask(id: string, done: boolean): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const current = await db.task.findFirst({ where: { id }, select: { doneAt: true, ...SPAWN_SELECT } });
    if (!current) return { ok: false, error: "invalid" };

    await db.task.updateMany({
      where: { id },
      data: done
        ? { doneAt: new Date(), status: "DONE", progress: 100 }
        : { doneAt: null, status: "TODO", progress: 0 },
    });
    if (done && current.doneAt == null) await spawnNextOccurrence(db, current);
    if (done && current.doneAt == null && current.opportunityId) {
      await runAutomations(ctx.organizationId, { type: "task_completed", opportunityId: current.opportunityId }, ctx.user.name);
    }
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to toggle task", error);
    return { ok: false, error: "unknown" };
  }
}

/** Set the workflow status (Teams-style: A fazer / Em andamento / Concluída),
 * keeping doneAt/progress in sync. Completing a recurring task spawns the next. */
export async function setTaskStatus(id: string, status: TaskStatus): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const current = await db.task.findFirst({ where: { id }, select: { doneAt: true, progress: true, ...SPAWN_SELECT } });
    if (!current) return { ok: false, error: "invalid" };

    const isDone = status === "DONE";
    const data =
      status === "DONE"
        ? { status, doneAt: current.doneAt ?? new Date(), progress: 100 }
        : status === "IN_PROGRESS"
          ? { status, doneAt: null, progress: current.progress >= 100 ? 50 : current.progress || 25 }
          : { status, doneAt: null, progress: 0 };
    await db.task.updateMany({ where: { id }, data });
    if (isDone && current.doneAt == null) await spawnNextOccurrence(db, current);
    if (isDone && current.doneAt == null && current.opportunityId) {
      await runAutomations(ctx.organizationId, { type: "task_completed", opportunityId: current.opportunityId }, ctx.user.name);
    }
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to set task status", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteTask(id: string): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    await tenantDb(ctx.organizationId).task.deleteMany({ where: { id } });
    await audit(ctx, { action: "task.deleted", entity: "Task", entityId: id });
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete task", error);
    return { ok: false, error: "unknown" };
  }
}

/* ── Checklist (subtasks) ─────────────────────────────────────────────────── */

/** Recompute a task's progress from its checklist (only when it has items). */
async function recomputeProgress(db: ReturnType<typeof tenantDb>, taskId: string): Promise<void> {
  const items = await db.taskChecklistItem.findMany({ where: { taskId }, select: { done: true } });
  if (items.length === 0) return;
  const done = items.filter((i) => i.done).length;
  const task = await db.task.findFirst({ where: { id: taskId }, select: { doneAt: true } });
  if (task?.doneAt) return; // completed tasks stay at 100
  await db.task.updateMany({ where: { id: taskId }, data: { progress: clampPct((done / items.length) * 100) } });
}

export async function addChecklistItem(taskId: string, text: string): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = checklistTextSchema.safeParse(text);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const task = await db.task.findFirst({ where: { id: taskId }, select: { id: true } });
    if (!task) return { ok: false, error: "invalid" };
    const count = await db.taskChecklistItem.count({ where: { taskId } });
    const item = await db.taskChecklistItem.create({
      data: { organizationId: ctx.organizationId, taskId, text: parsed.data, order: count },
      select: { id: true },
    });
    await recomputeProgress(db, taskId);
    revalidate();
    return { ok: true, id: item.id };
  } catch (error) {
    console.error("Failed to add checklist item", error);
    return { ok: false, error: "unknown" };
  }
}

export async function toggleChecklistItem(itemId: string, done: boolean): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const item = await db.taskChecklistItem.findFirst({ where: { id: itemId }, select: { taskId: true } });
    if (!item) return { ok: false, error: "invalid" };
    await db.taskChecklistItem.updateMany({ where: { id: itemId }, data: { done } });
    await recomputeProgress(db, item.taskId);
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to toggle checklist item", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteChecklistItem(itemId: string): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const item = await db.taskChecklistItem.findFirst({ where: { id: itemId }, select: { taskId: true } });
    if (!item) return { ok: false, error: "invalid" };
    await db.taskChecklistItem.deleteMany({ where: { id: itemId } });
    await recomputeProgress(db, item.taskId);
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete checklist item", error);
    return { ok: false, error: "unknown" };
  }
}

/* ── Attachments ──────────────────────────────────────────────────────────── */

/** Remove a task attachment (row + stored bytes). Upload is the API route. */
export async function deleteTaskAttachment(attachmentId: string): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    const db = tenantDb(ctx.organizationId);
    const att = await db.taskAttachment.findFirst({ where: { id: attachmentId }, select: { url: true } });
    if (!att) return { ok: false, error: "invalid" };
    await db.taskAttachment.deleteMany({ where: { id: attachmentId } });
    await deleteMedia(att.url);
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete task attachment", error);
    return { ok: false, error: "unknown" };
  }
}
