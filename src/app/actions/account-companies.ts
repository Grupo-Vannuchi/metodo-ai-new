"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/tenant";
import { createSession } from "@/lib/session";
import { slugify } from "@/lib/slug";
import { createDefaultPipeline } from "@/lib/default-pipeline";
import { LIMITS } from "@/config/limits";
import { countAccountCompanies } from "@/lib/queries/accounts";

export type CompanyActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: "unauthorized" | "forbidden" | "invalid" | "limit" | "unknown" };

/** A slug unique across organizations (mirrors signup). */
async function uniqueOrgSlug(name: string): Promise<string> {
  const base = slugify(name) || "empresa";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Switch the active company. Re-seals the session with the target org + the
 * user's role there. Only companies the user is a member of are allowed — the
 * membership check is the security boundary.
 */
export async function switchCompany(orgId: string): Promise<CompanyActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };
  if (orgId === ctx.organizationId) return { ok: true };

  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: ctx.userId } },
    select: { role: true },
  });
  if (!membership) return { ok: false, error: "forbidden" };

  await createSession({ userId: ctx.userId, organizationId: orgId, role: membership.role });
  revalidatePath("/app", "layout");
  return { ok: true, id: orgId };
}

/**
 * Create a new company under the current account and switch to it. The creator
 * becomes its OWNER; enforced against the per-account company limit. Starts
 * "cru" — the owner installs owned modules per company from the Loja.
 */
export async function createCompany(name: string): Promise<CompanyActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const trimmed = (name ?? "").trim().slice(0, 120);
  if (trimmed.length < 2) return { ok: false, error: "invalid" };

  const count = await countAccountCompanies(ctx.userId);
  if (count >= LIMITS.companiesPerAccount) return { ok: false, error: "limit" };

  try {
    const slug = await uniqueOrgSlug(trimmed);
    const orgId = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        // Skip the onboarding wizard; the owner installs owned modules from the Loja.
        data: { name: trimmed, slug, ownerId: ctx.userId, onboardedAt: new Date() },
      });
      await tx.membership.create({
        data: { organizationId: org.id, userId: ctx.userId, role: "OWNER" },
      });
      await createDefaultPipeline(tx, org.id);
      return org.id;
    });

    await createSession({ userId: ctx.userId, organizationId: orgId, role: "OWNER" });
    revalidatePath("/app", "layout");
    return { ok: true, id: orgId };
  } catch (error) {
    console.error("createCompany failed", error);
    return { ok: false, error: "unknown" };
  }
}
