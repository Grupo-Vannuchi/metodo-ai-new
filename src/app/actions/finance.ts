"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext, type OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasFeature, type PlanKey } from "@/config/plans";
import { audit } from "@/lib/audit";
import { entrySchema, categorySchema, type EntryInput } from "@/lib/validations/finance";

export type FinanceResult =
  | { ok: true; id?: string }
  | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "unknown" };

/** Finance is plan-gated (PLUS+) and screen-gated (access template). */
function denyReason(ctx: OrgContext): "forbidden" | null {
  if (!hasFeature(ctx.organization.plan as PlanKey, "finance")) return "forbidden";
  if (!canAccessScreen(ctx, "finance")) return "forbidden";
  return null;
}

/** Map a validated entry form into Prisma write data. */
function entryData(input: EntryInput) {
  const settledAt =
    input.status === "SETTLED"
      ? input.settledAt
        ? new Date(input.settledAt)
        : new Date()
      : null; // pending entries are not realized
  return {
    type: input.type,
    description: input.description,
    amount: input.amount,
    status: input.status,
    dueDate: new Date(input.dueDate),
    settledAt,
    method: input.method || null,
    categoryId: input.categoryId || null,
    contactId: input.contactId || null,
    companyId: input.companyId || null,
    opportunityId: input.opportunityId || null,
    notes: input.notes || null,
  };
}

function parse(formData: FormData) {
  return entrySchema.safeParse({
    type: formData.get("type"),
    description: formData.get("description"),
    amount: formData.get("amount"),
    status: formData.get("status") ?? "PENDING",
    dueDate: formData.get("dueDate"),
    settledAt: formData.get("settledAt"),
    method: formData.get("method"),
    categoryId: formData.get("categoryId"),
    contactId: formData.get("contactId"),
    companyId: formData.get("companyId"),
    opportunityId: formData.get("opportunityId"),
    notes: formData.get("notes"),
    // Absent when editing or for a settled entry; null breaks the numeric coerce.
    installments: formData.get("installments") ?? undefined,
  });
}

export async function createEntry(formData: FormData): Promise<FinanceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (denyReason(ctx)) return { ok: false, error: "forbidden" };

  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const n = parsed.data.installments ?? 1;

  try {
    const base = entryData(parsed.data);

    // Installments: split the total into N monthly pending entries.
    if (n > 1) {
      const cents = Math.round(parsed.data.amount * 100);
      const per = Math.floor(cents / n);
      const remainder = cents - per * n;
      const groupId = crypto.randomUUID();
      const due = new Date(parsed.data.dueDate);
      const rows = Array.from({ length: n }, (_, i) => ({
        organizationId: ctx.organizationId,
        createdById: ctx.userId,
        type: base.type,
        description: `${base.description} (${i + 1}/${n})`,
        amount: (per + (i === n - 1 ? remainder : 0)) / 100,
        status: "PENDING" as const,
        dueDate: new Date(due.getFullYear(), due.getMonth() + i, due.getDate()),
        settledAt: null,
        method: base.method,
        categoryId: base.categoryId,
        contactId: base.contactId,
        companyId: base.companyId,
        opportunityId: base.opportunityId,
        notes: base.notes,
        installmentGroupId: groupId,
        installmentNo: i + 1,
        installmentTotal: n,
      }));
      await tenantDb(ctx.organizationId).financeEntry.createMany({ data: rows });
      await audit(ctx, {
        action: "finance.entry.created",
        entity: "FinanceEntry",
        meta: { type: parsed.data.type, amount: parsed.data.amount, installments: n },
      });
      revalidatePath("/app/finance");
      return { ok: true };
    }

    const e = await tenantDb(ctx.organizationId).financeEntry.create({
      data: { organizationId: ctx.organizationId, createdById: ctx.userId, ...base },
      select: { id: true },
    });
    await audit(ctx, {
      action: "finance.entry.created",
      entity: "FinanceEntry",
      entityId: e.id,
      meta: { type: parsed.data.type, amount: parsed.data.amount, status: parsed.data.status },
    });
    revalidatePath("/app/finance");
    return { ok: true, id: e.id };
  } catch (error) {
    console.error("Failed to create entry", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateEntry(id: string, formData: FormData): Promise<FinanceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (denyReason(ctx)) return { ok: false, error: "forbidden" };

  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    await tenantDb(ctx.organizationId).financeEntry.updateMany({ where: { id }, data: entryData(parsed.data) });
    await audit(ctx, { action: "finance.entry.updated", entity: "FinanceEntry", entityId: id });
    revalidatePath("/app/finance");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update entry", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteEntry(id: string): Promise<FinanceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (denyReason(ctx)) return { ok: false, error: "forbidden" };
  try {
    await tenantDb(ctx.organizationId).financeEntry.deleteMany({ where: { id } });
    await audit(ctx, { action: "finance.entry.deleted", entity: "FinanceEntry", entityId: id });
    revalidatePath("/app/finance");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete entry", error);
    return { ok: false, error: "unknown" };
  }
}

/** Quick toggle realized/pending from the list. */
export async function settleEntry(id: string, settled: boolean): Promise<FinanceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (denyReason(ctx)) return { ok: false, error: "forbidden" };
  try {
    await tenantDb(ctx.organizationId).financeEntry.updateMany({
      where: { id },
      data: { status: settled ? "SETTLED" : "PENDING", settledAt: settled ? new Date() : null },
    });
    await audit(ctx, {
      action: settled ? "finance.entry.settled" : "finance.entry.reopened",
      entity: "FinanceEntry",
      entityId: id,
    });
    revalidatePath("/app/finance");
    return { ok: true };
  } catch (error) {
    console.error("Failed to settle entry", error);
    return { ok: false, error: "unknown" };
  }
}

export async function createFinanceCategory(name: string, type: string): Promise<FinanceResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (denyReason(ctx)) return { ok: false, error: "forbidden" };

  const parsed = categorySchema.safeParse({ name, type });
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const c = await tenantDb(ctx.organizationId).financeCategory.create({
      data: { organizationId: ctx.organizationId, name: parsed.data.name, type: parsed.data.type },
      select: { id: true },
    });
    revalidatePath("/app/finance");
    return { ok: true, id: c.id };
  } catch (error) {
    // Unique (org,type,name) collision → treat as invalid (already exists).
    console.error("Failed to create category", error);
    return { ok: false, error: "invalid" };
  }
}
