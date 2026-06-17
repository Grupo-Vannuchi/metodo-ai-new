"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrgContext, assertRole } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { audit } from "@/lib/audit";
import {
  accessTemplateSchema,
  type AccessTemplateInput,
} from "@/lib/validations/access-template";

export type AccessResult =
  | { ok: true; id?: string }
  | { ok: false; error: "forbidden" | "invalid" | "not_found" | "unknown" };

function ensureAdmin(ctx: Awaited<ReturnType<typeof getOrgContext>>): boolean {
  if (!ctx) return false;
  try {
    assertRole(ctx, "ADMIN");
    return true;
  } catch {
    return false;
  }
}

export async function createAccessTemplate(input: AccessTemplateInput): Promise<AccessResult> {
  const ctx = await getOrgContext();
  if (!ensureAdmin(ctx)) return { ok: false, error: "forbidden" };
  const parsed = accessTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx!.organizationId);
    const tpl = await db.accessTemplate.create({
      data: {
        organizationId: ctx!.organizationId,
        name: parsed.data.name,
        screens: parsed.data.screens,
      },
      select: { id: true },
    });
    await audit(ctx!, { action: "access_template.created", entity: "AccessTemplate", entityId: tpl.id });
    revalidatePath("/app/settings/access");
    return { ok: true, id: tpl.id };
  } catch (error) {
    console.error("Failed to create access template", error);
    return { ok: false, error: "unknown" };
  }
}

export async function updateAccessTemplate(
  id: string,
  input: AccessTemplateInput,
): Promise<AccessResult> {
  const ctx = await getOrgContext();
  if (!ensureAdmin(ctx)) return { ok: false, error: "forbidden" };
  const parsed = accessTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx!.organizationId);
    const res = await db.accessTemplate.updateMany({
      where: { id },
      data: { name: parsed.data.name, screens: parsed.data.screens },
    });
    if (res.count === 0) return { ok: false, error: "not_found" };
    await audit(ctx!, { action: "access_template.updated", entity: "AccessTemplate", entityId: id });
    revalidatePath("/app/settings/access");
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update access template", error);
    return { ok: false, error: "unknown" };
  }
}

/** Delete a template. Members assigned to it revert to full access (FK SET NULL). */
export async function deleteAccessTemplate(id: string): Promise<AccessResult> {
  const ctx = await getOrgContext();
  if (!ensureAdmin(ctx)) return { ok: false, error: "forbidden" };
  try {
    const db = tenantDb(ctx!.organizationId);
    await db.accessTemplate.deleteMany({ where: { id } });
    await audit(ctx!, { action: "access_template.deleted", entity: "AccessTemplate", entityId: id });
    revalidatePath("/app/settings/access");
    revalidatePath("/app/settings/team");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete access template", error);
    return { ok: false, error: "unknown" };
  }
}

/** Assign (or clear, with null) a member's access template. */
export async function setMemberTemplate(
  membershipId: string,
  templateId: string | null,
): Promise<AccessResult> {
  const ctx = await getOrgContext();
  if (!ensureAdmin(ctx)) return { ok: false, error: "forbidden" };

  try {
    const member = await prisma.membership.findFirst({
      where: { id: membershipId, organizationId: ctx!.organizationId },
      select: { id: true },
    });
    if (!member) return { ok: false, error: "not_found" };

    if (templateId) {
      const tpl = await prisma.accessTemplate.findFirst({
        where: { id: templateId, organizationId: ctx!.organizationId },
        select: { id: true },
      });
      if (!tpl) return { ok: false, error: "not_found" };
    }

    await prisma.membership.updateMany({
      where: { id: membershipId, organizationId: ctx!.organizationId },
      data: { accessTemplateId: templateId },
    });
    await audit(ctx!, {
      action: "member.template_set",
      entity: "Membership",
      entityId: membershipId,
      meta: { templateId },
    });
    revalidatePath("/app/settings/team");
    return { ok: true };
  } catch (error) {
    console.error("Failed to set member template", error);
    return { ok: false, error: "unknown" };
  }
}
