"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";

const folderSchema = z.object({ name: z.string().trim().min(1, "Informe um nome.").max(80) });

export type FolderResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

export async function createCompanyFolder(input: { name: string }): Promise<FolderResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = folderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    const count = await db.companyFolder.count();
    const folder = await db.companyFolder.create({
      data: { organizationId: ctx.organizationId, name: parsed.data.name, order: count },
    });
    revalidatePath("/app/companies");
    return { ok: true, id: folder.id };
  } catch (error) {
    console.error("Failed to create company folder", error);
    return { ok: false, error: "unknown" };
  }
}

export async function renameCompanyFolder(id: string, input: { name: string }): Promise<FolderResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  const parsed = folderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  try {
    const db = tenantDb(ctx.organizationId);
    await db.companyFolder.updateMany({ where: { id }, data: { name: parsed.data.name } });
    revalidatePath("/app/companies");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to rename company folder", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a folder. Its companies are kept and become unfiled (FK SET NULL). */
export async function deleteCompanyFolder(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    await db.companyFolder.deleteMany({ where: { id } });
    revalidatePath("/app/companies");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete company folder", error);
    return { ok: false };
  }
}

/** Move a company to a folder, or to "unfiled" when `folderId` is null. */
export async function moveCompanyToFolder(companyId: string, folderId: string | null): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    const db = tenantDb(ctx.organizationId);
    if (folderId) {
      const folder = await db.companyFolder.findFirst({ where: { id: folderId }, select: { id: true } });
      if (!folder) return { ok: false };
    }
    await db.company.updateMany({ where: { id: companyId }, data: { folderId } });
    revalidatePath("/app/companies");
    return { ok: true };
  } catch (error) {
    console.error("Failed to move company", error);
    return { ok: false };
  }
}
