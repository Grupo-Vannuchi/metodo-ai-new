"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";

type Ok = { ok: boolean };
type FolderResult = { ok: true; id?: string } | { ok: false };

/** Create a team-chat folder (org-shared). Returns its id. */
export async function createTeamFolder(name: string): Promise<FolderResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false };
  try {
    const folder = await tenantDb(ctx.organizationId).teamChatFolder.create({
      data: { organizationId: ctx.organizationId, name: clean },
      select: { id: true },
    });
    revalidatePath("/app/inbox");
    return { ok: true, id: folder.id };
  } catch (error) {
    console.error("Failed to create team folder", error);
    return { ok: false };
  }
}

export async function renameTeamFolder(id: string, name: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).teamChatFolder.updateMany({ where: { id }, data: { name: clean } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to rename team folder", error);
    return { ok: false };
  }
}

/** Delete a folder. Its members fall back to "no folder" (FK SetNull). */
export async function deleteTeamFolder(id: string): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await tenantDb(ctx.organizationId).teamChatFolder.deleteMany({ where: { id } });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete team folder", error);
    return { ok: false };
  }
}

/** Move a member into a folder (null = no folder). Validates folder ownership. */
export async function moveTeamMember(userId: string, folderId: string | null): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    if (folderId) {
      const folder = await tenantDb(ctx.organizationId).teamChatFolder.findFirst({
        where: { id: folderId },
        select: { id: true },
      });
      if (!folder) return { ok: false };
    }
    // Membership isn't a tenant model — scope by org explicitly.
    await prisma.membership.updateMany({
      where: { organizationId: ctx.organizationId, userId },
      data: { teamFolderId: folderId },
    });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to move team member", error);
    return { ok: false };
  }
}

/** Pin / unpin a member (sorts to the top of the list). */
export async function pinTeamMember(userId: string, pinned: boolean): Promise<Ok> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };
  try {
    await prisma.membership.updateMany({
      where: { organizationId: ctx.organizationId, userId },
      data: { teamPinned: pinned },
    });
    revalidatePath("/app/inbox");
    return { ok: true };
  } catch (error) {
    console.error("Failed to pin team member", error);
    return { ok: false };
  }
}
