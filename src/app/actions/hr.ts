"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { deleteMedia } from "@/lib/storage/blob";
import { employeeSchema, catalogSchema, type EmployeeInput, type CatalogInput } from "@/lib/validations/employee";

export type HrActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "duplicate" | "unknown" };

const money = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const dateOrNull = (s?: string) => (s && s.trim() ? new Date(s) : null);
const orNull = (s?: string) => (s && s.trim() ? s.trim() : null);

/** Keep only digits (CPF/CNPJ are stored normalized). */
const digits = (s?: string) => (s ? s.replace(/\D+/g, "") || null : null);

/** Verify a catalog id belongs to the org; returns it or null. */
async function catalogInOrg(
  organizationId: string,
  model: "department" | "jobRole",
  id?: string,
): Promise<string | null> {
  if (!id) return null;
  const db = tenantDb(organizationId);
  const found =
    model === "department"
      ? await db.department.findFirst({ where: { id }, select: { id: true } })
      : await db.jobRole.findFirst({ where: { id }, select: { id: true } });
  return found?.id ?? null;
}

/** Verify the user is a member of this org before linking them to an employee. */
async function memberInOrg(organizationId: string, userId?: string): Promise<string | null> {
  if (!userId) return null;
  const m = await prisma.membership.findFirst({
    where: { organizationId, userId },
    select: { userId: true },
  });
  return m?.userId ?? null;
}

/** Map the validated form input to the Prisma payload (shared by create/update). */
async function toData(organizationId: string, input: EmployeeInput) {
  const [departmentId, jobRoleId, userId] = await Promise.all([
    catalogInOrg(organizationId, "department", input.departmentId || undefined),
    catalogInOrg(organizationId, "jobRole", input.jobRoleId || undefined),
    memberInOrg(organizationId, input.userId || undefined),
  ]);

  return {
    name: input.name.trim(),
    email: orNull(input.email),
    phone: orNull(input.phone),
    documentType: input.documentType ? input.documentType : null,
    document: digits(input.document),
    birthDate: dateOrNull(input.birthDate),
    userId,
    addressZip: orNull(input.addressZip),
    addressStreet: orNull(input.addressStreet),
    addressNumber: orNull(input.addressNumber),
    addressCity: orNull(input.addressCity),
    addressState: input.addressState ? input.addressState.trim().toUpperCase() : null,
    jobRoleId,
    departmentId,
    contractType: input.contractType,
    status: input.status,
    hiredAt: new Date(input.hiredAt),
    probationEndsAt: dateOrNull(input.probationEndsAt),
    // Termination data only makes sense for a terminated employee.
    terminatedAt: input.status === "TERMINATED" ? dateOrNull(input.terminatedAt) : null,
    terminationReason: input.status === "TERMINATED" ? orNull(input.terminationReason) : null,
    baseSalary: money(input.baseSalary),
    weeklyHours: input.weeklyHours ?? null,
    bankName: orNull(input.bankName),
    bankBranch: orNull(input.bankBranch),
    bankAccount: orNull(input.bankAccount),
    pixKey: orNull(input.pixKey),
    notes: orNull(input.notes),
  };
}

export async function createEmployee(input: EmployeeInput): Promise<HrActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const data = await toData(org, parsed.data);

    // One employee per system user (enforced by a unique index too).
    if (data.userId) {
      const taken = await tenantDb(org).employee.findFirst({
        where: { userId: data.userId },
        select: { id: true },
      });
      if (taken) return { ok: false, error: "duplicate" };
    }

    const employee = await prisma.employee.create({
      data: { organizationId: org, createdById: ctx.userId, ...data },
      select: { id: true },
    });

    revalidatePath("/app/hr");
    revalidatePath("/app/hr/employees");
    return { ok: true, id: employee.id };
  } catch (error) {
    console.error("Failed to create employee", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateEmployee(id: string, input: EmployeeInput): Promise<HrActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const db = tenantDb(org);
    const current = await db.employee.findFirst({ where: { id }, select: { id: true } });
    if (!current) return { ok: false, error: "unknown" };

    const data = await toData(org, parsed.data);

    if (data.userId) {
      const taken = await db.employee.findFirst({
        where: { userId: data.userId, NOT: { id } },
        select: { id: true },
      });
      if (taken) return { ok: false, error: "duplicate" };
    }

    const res = await db.employee.updateMany({ where: { id }, data });
    if (res.count === 0) return { ok: false, error: "unknown" };

    revalidatePath("/app/hr");
    revalidatePath("/app/hr/employees");
    revalidatePath(`/app/hr/employees/${id}`);
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update employee", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteEmployee(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    // Drop the document blobs before the rows cascade away (best-effort).
    const docs = await db.employeeDocument.findMany({ where: { employeeId: id }, select: { url: true } });
    await Promise.all(docs.map((d) => deleteMedia(d.url).catch(() => {})));
    await db.employee.deleteMany({ where: { id } });

    revalidatePath("/app/hr");
    revalidatePath("/app/hr/employees");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete employee", error);
    return { ok: false };
  }
}

export async function deleteEmployeeDocument(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    const doc = await db.employeeDocument.findFirst({
      where: { id },
      select: { url: true, employeeId: true },
    });
    if (!doc) return { ok: false };
    await db.employeeDocument.deleteMany({ where: { id } });
    await deleteMedia(doc.url).catch(() => {});
    revalidatePath(`/app/hr/employees/${doc.employeeId}`);
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete employee document", error);
    return { ok: false };
  }
}

// ───────────────────────────────────────────── Catalogs (departments / roles)

type CatalogModel = "department" | "jobRole";

export async function createCatalogItem(model: CatalogModel, input: CatalogInput): Promise<HrActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const org = ctx.organizationId;
    const data = { organizationId: org, name: parsed.data.name };
    const row =
      model === "department"
        ? await prisma.department.create({ data, select: { id: true } })
        : await prisma.jobRole.create({ data, select: { id: true } });

    revalidatePath("/app/hr/settings");
    return { ok: true, id: row.id };
  } catch (error) {
    // Unique([organizationId, name]) — a same-named item already exists.
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return { ok: false, error: "duplicate" };
    }
    console.error("Failed to create catalog item", error);
    return { ok: false, error: "unknown" };
  }
}

export async function renameCatalogItem(
  model: CatalogModel,
  id: string,
  input: CatalogInput,
): Promise<HrActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const data = { name: parsed.data.name };
    const res =
      model === "department"
        ? await db.department.updateMany({ where: { id }, data })
        : await db.jobRole.updateMany({ where: { id }, data });
    if (res.count === 0) return { ok: false, error: "unknown" };

    revalidatePath("/app/hr/settings");
    return { ok: true, id };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return { ok: false, error: "duplicate" };
    }
    console.error("Failed to rename catalog item", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a department/role. Employees keep their record (the FK is SetNull). */
export async function deleteCatalogItem(model: CatalogModel, id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    if (model === "department") await db.department.deleteMany({ where: { id } });
    else await db.jobRole.deleteMany({ where: { id } });

    revalidatePath("/app/hr/settings");
    revalidatePath("/app/hr/employees");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete catalog item", error);
    return { ok: false };
  }
}
