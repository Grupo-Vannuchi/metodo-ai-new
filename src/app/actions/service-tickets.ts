"use server";

import { revalidatePath } from "next/cache";
import { type ServiceTicketStatus } from "@prisma/client";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb, type TenantDb } from "@/lib/tenant-db";
import { serviceTicketSchema, returnServiceSchema } from "@/lib/validations/service-ticket";

export type ServiceResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" | "state" };

const s = (v?: string) => (v && v.trim() ? v.trim() : null);

async function validId(db: TenantDb, model: "asset" | "company", id?: string): Promise<string | null> {
  const v = id?.trim();
  if (!v) return null;
  const row =
    model === "asset"
      ? await db.asset.findFirst({ where: { id: v }, select: { id: true } })
      : await db.company.findFirst({ where: { id: v }, select: { id: true } });
  return row?.id ?? null;
}

async function nextCode(db: TenantDb): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const count = await db.serviceTicket.count({ where: { code: { endsWith: `/${yy}` } } });
  return `${String(count + 1).padStart(4, "0")}/${yy}`;
}

export async function createServiceTicket(input: unknown): Promise<ServiceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = serviceTicketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  try {
    const db = tenantDb(ctx.organizationId);
    const [assetId, companyId] = await Promise.all([validId(db, "asset", d.assetId), validId(db, "company", d.companyId)]);
    const code = await nextCode(db);
    const tk = await db.serviceTicket.create({
      data: {
        organizationId: ctx.organizationId,
        code,
        assetId,
        companyId,
        equipment: d.equipment.trim(),
        status: "RECEIVED",
        description: s(d.description),
        receivedAt: d.receivedAt,
        expectedReturn: d.expectedReturn ?? null,
        responsible: s(d.responsible),
        notes: s(d.notes),
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    revalidatePath("/app/supplies/client-equipment");
    return { ok: true, id: tk.id };
  } catch (e) {
    console.error("createServiceTicket failed", e);
    return { ok: false, error: "unknown" };
  }
}

const TRANSITIONS: Record<string, { from: string[]; to: ServiceTicketStatus }> = {
  start: { from: ["RECEIVED"], to: "IN_SERVICE" },
  ready: { from: ["IN_SERVICE"], to: "READY" },
  cancel: { from: ["RECEIVED", "IN_SERVICE", "READY"], to: "CANCELED" },
};

export async function setServiceStatus(id: string, action: string): Promise<ServiceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const rule = TRANSITIONS[action];
  if (!rule) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const tk = await db.serviceTicket.findFirst({ where: { id }, select: { status: true } });
    if (!tk) return { ok: false, error: "unknown" };
    if (!rule.from.includes(tk.status)) return { ok: false, error: "state" };
    await db.serviceTicket.updateMany({ where: { id }, data: { status: rule.to } });
    revalidatePath("/app/supplies/client-equipment");
    return { ok: true, id };
  } catch (e) {
    console.error("setServiceStatus failed", e);
    return { ok: false, error: "unknown" };
  }
}

/** Return the equipment to the client: closes the ticket with return date + cost. */
export async function returnServiceTicket(id: string, input: unknown): Promise<ServiceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = returnServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  try {
    const db = tenantDb(ctx.organizationId);
    const tk = await db.serviceTicket.findFirst({ where: { id }, select: { status: true, notes: true } });
    if (!tk) return { ok: false, error: "unknown" };
    if (!["RECEIVED", "IN_SERVICE", "READY"].includes(tk.status)) return { ok: false, error: "state" };
    await db.serviceTicket.updateMany({
      where: { id },
      data: {
        status: "RETURNED",
        returnedAt: d.returnedAt ?? new Date(),
        cost: d.cost ?? null,
        notes: s(d.notes) ?? tk.notes,
      },
    });
    revalidatePath("/app/supplies/client-equipment");
    return { ok: true, id };
  } catch (e) {
    console.error("returnServiceTicket failed", e);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteServiceTicket(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    const tk = await db.serviceTicket.findFirst({ where: { id }, select: { status: true } });
    if (!tk) return { ok: false };
    if (!["RETURNED", "CANCELED"].includes(tk.status)) return { ok: false };
    await db.serviceTicket.deleteMany({ where: { id } });
    revalidatePath("/app/supplies/client-equipment");
    return { ok: true };
  } catch (e) {
    console.error("deleteServiceTicket failed", e);
    return { ok: false };
  }
}
