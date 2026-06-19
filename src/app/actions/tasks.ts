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
): Promise<string> {
  if (!userId) return fallback;
  const m = await prisma.membership.findFirst({
    where: { organizationId, userId },
    select: { userId: true },
  });
  return m?.userId ?? fallback;
}

const dateOrNull = (s?: string) => (s && s.trim() ? new Date(s) : null);

function parse(formData: FormData) {
  return taskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    type: formData.get("type") ?? "OTHER",
    priority: formData.get("priority") ?? "MEDIUM",
    dueDate: formData.get("dueDate"),
    assignedToId: formData.get("assignedToId"),
    contactId: formData.get("contactId"),
    companyId: formData.get("companyId"),
    opportunityId: formData.get("opportunityId"),
  });
}

async function buildData(organizationId: string, userId: string, input: ReturnType<typeof taskSchema.parse>) {
  const [assignedToId, contactId, companyId, opportunityId] = await Promise.all([
    resolveAssignee(organizationId, input.assignedToId, userId),
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
    const data = await buildData(ctx.organizationId, ctx.userId, parsed.data);
    const task = await tenantDb(ctx.organizationId).task.create({
      data: { organizationId: ctx.organizationId, createdById: ctx.userId, ...data },
      select: { id: true },
    });
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
    const data = await buildData(ctx.organizationId, ctx.userId, parsed.data);
    await tenantDb(ctx.organizationId).task.updateMany({ where: { id }, data });
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
