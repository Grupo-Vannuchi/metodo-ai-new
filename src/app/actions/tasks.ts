"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { taskSchema } from "@/lib/validations/task";

export type TaskResult =
  | { ok: true; id?: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

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

async function resolveAssignee(
  organizationId: string,
  userId: string | undefined,
  fallback: string,
  role: "OWNER" | "ADMIN" | "MEMBER",
): Promise<string> {
  const targetId = role === "MEMBER" ? fallback : userId;
  if (!targetId) return fallback;
  const m = await prisma.membership.findFirst({
    where: { organizationId, userId: targetId },
    select: { userId: true },
  });
  return m?.userId ?? fallback;
}

const dateOrNull = (s?: string) => (s && s.trim() ? new Date(s) : null);

function parse(formData: FormData) {
  // Fields the form omits (e.g. company/description) come back as null, which
  // the optional string schemas reject — normalize missing values to undefined.
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : undefined;
  };
  return taskSchema.safeParse({
    title: str("title"),
    description: str("description"),
    type: str("type") ?? "OTHER",
    priority: str("priority") ?? "MEDIUM",
    dueDate: str("dueDate"),
    assignedToId: str("assignedToId"),
    contactId: str("contactId"),
    companyId: str("companyId"),
    opportunityId: str("opportunityId"),
  });
}

async function buildData(organizationId: string, userId: string, role: "OWNER" | "ADMIN" | "MEMBER", input: ReturnType<typeof taskSchema.parse>, currentAssignedToId?: string | null) {
  const fallback = currentAssignedToId || userId;
  const [assignedToId, contactId, companyId, opportunityId] = await Promise.all([
    resolveAssignee(organizationId, input.assignedToId, fallback, role),
    existsInOrg(organizationId, "contact", input.contactId),
    existsInOrg(organizationId, "company", input.companyId),
    existsInOrg(organizationId, "opportunity", input.opportunityId),
  ]);
  return {
    title: input.title,
    description: input.description || null,
    type: input.type,
    priority: input.priority,
    dueDate: dateOrNull(input.dueDate),
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

export async function createTask(formData: FormData): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const data = await buildData(ctx.organizationId, ctx.userId, ctx.role, parsed.data);
    const task = await tenantDb(ctx.organizationId).task.create({
      data: { organizationId: ctx.organizationId, createdById: ctx.userId, ...data },
      select: { id: true },
    });
    if (data.assignedToId && data.assignedToId !== ctx.userId) {
      await tenantDb(ctx.organizationId).notification.create({
        data: {
          organizationId: ctx.organizationId,
          userId: data.assignedToId,
          type: "TASK_ASSIGNED",
          data: { actor: ctx.user.name, title: data.title },
          link: `/app/tasks/${task.id}`,
        },
      });
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
    const current = await db.task.findFirst({ where: { id }, select: { assignedToId: true } });
    if (!current) return { ok: false, error: "invalid" };

    const data = await buildData(ctx.organizationId, ctx.userId, ctx.role, parsed.data, current.assignedToId);
    await db.task.updateMany({ where: { id }, data });
    if (data.assignedToId && data.assignedToId !== current.assignedToId && data.assignedToId !== ctx.userId) {
      await db.notification.create({
        data: {
          organizationId: ctx.organizationId,
          userId: data.assignedToId,
          type: "TASK_ASSIGNED",
          data: { actor: ctx.user.name, title: data.title },
          link: `/app/tasks/${id}`,
        },
      });
    }
    await audit(ctx, { action: "task.updated", entity: "Task", entityId: id });
    revalidate();
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update task", error);
    return { ok: false, error: "unknown" };
  }
}

export async function toggleTask(id: string, done: boolean): Promise<TaskResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  try {
    await tenantDb(ctx.organizationId).task.updateMany({
      where: { id },
      data: { doneAt: done ? new Date() : null },
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    console.error("Failed to toggle task", error);
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
