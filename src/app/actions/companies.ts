"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { companySchema, type CompanyInput } from "@/lib/validations/company";

export type CompanyActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

function toData(input: CompanyInput) {
  return {
    name: input.name,
    cnpj: input.cnpj || null,
    email: input.email || null,
    phone: input.phone || null,
    website: input.website || null,
    notes: input.notes || null,
    address: {
      street: input.street || "",
      city: input.city || "",
      uf: input.uf || "",
      zip: input.zip || "",
    },
  };
}

export async function createCompany(
  input: CompanyInput,
): Promise<CompanyActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const company = await db.company.create({
      // organizationId is also enforced by the tenant extension; passed here
      // because Prisma's create input type requires it statically.
      data: { ...toData(parsed.data), source: "manual", organizationId: ctx.organizationId },
    });
    revalidatePath("/app/companies");
    return { ok: true, id: company.id };
  } catch (error) {
    console.error("Failed to create company", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateCompany(
  id: string,
  input: CompanyInput,
): Promise<CompanyActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    // updateMany so the tenant filter (org injected by the extension) applies;
    // count === 0 means the row isn't in this org.
    const res = await db.company.updateMany({
      where: { id },
      data: toData(parsed.data),
    });
    if (res.count === 0) return { ok: false, error: "unknown" };
    revalidatePath("/app/companies");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update company", error);
    return { ok: false, error: "unknown" };
  }
}

export async function deleteCompany(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.company.deleteMany({ where: { id } });
    revalidatePath("/app/companies");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete company", error);
    return { ok: false };
  }
}
