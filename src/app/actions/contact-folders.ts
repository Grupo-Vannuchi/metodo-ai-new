"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import {
  contactFolderSchema,
  type ContactFolderInput,
} from "@/lib/validations/contact-folder";

export type FolderResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "unknown" };

export async function createFolder(input: ContactFolderInput): Promise<FolderResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = contactFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const count = await db.contactFolder.count();
    const folder = await db.contactFolder.create({
      data: { organizationId: ctx.organizationId, name: parsed.data.name, order: count },
    });
    revalidatePath("/app/contacts");
    return { ok: true, id: folder.id };
  } catch (error) {
    console.error("Failed to create folder", error);
    return { ok: false, error: "unknown" };
  }
}

export async function renameFolder(
  id: string,
  input: ContactFolderInput,
): Promise<FolderResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = contactFolderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.contactFolder.updateMany({ where: { id }, data: { name: parsed.data.name } });
    revalidatePath("/app/contacts");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to rename folder", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a folder. Its contacts are kept and become unfiled (FK SET NULL). */
export async function deleteFolder(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.contactFolder.deleteMany({ where: { id } });
    revalidatePath("/app/contacts");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete folder", error);
    return { ok: false };
  }
}

/** Move a contact to a folder, or to "unfiled" when `folderId` is null. */
export async function moveContactToFolder(
  contactId: string,
  folderId: string | null,
): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);

    // A target folder must belong to this org (tenantDb scopes the lookup).
    if (folderId) {
      const folder = await db.contactFolder.findFirst({
        where: { id: folderId },
        select: { id: true },
      });
      if (!folder) return { ok: false };
    }

    await db.contact.updateMany({ where: { id: contactId }, data: { folderId } });
    revalidatePath("/app/contacts");
    return { ok: true };
  } catch (error) {
    console.error("Failed to move contact", error);
    return { ok: false };
  }
}
