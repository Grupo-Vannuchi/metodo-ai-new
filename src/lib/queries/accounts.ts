import "server-only";
import { prisma } from "@/lib/prisma";

/** A company in the account's switcher. */
export type AccountCompany = {
  id: string;
  name: string;
  slug: string;
  /** Count of ACTIVE modules installed in this company. */
  activeModules: number;
};

/**
 * The companies owned by an account (the owner user). Powers the sidebar
 * switcher and the "manage companies" view. Ordered oldest-first (the account's
 * original company stays on top).
 */
export async function listAccountCompanies(ownerId: string): Promise<AccountCompany[]> {
  const orgs = await prisma.organization.findMany({
    where: { ownerId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { modules: { where: { status: "ACTIVE" } } } },
    },
  });
  return orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, activeModules: o._count.modules }));
}

/** Number of companies the account already has (for the per-account limit). */
export async function countAccountCompanies(ownerId: string): Promise<number> {
  return prisma.organization.count({ where: { ownerId } });
}

/** The module ids the account has PURCHASED (entitlements) — billed once, and the
 *  set any of the account's companies may install. */
export async function accountOwnedModuleIds(ownerId: string): Promise<string[]> {
  const rows = await prisma.accountModule.findMany({
    where: { ownerUserId: ownerId },
    select: { moduleId: true },
  });
  return rows.map((r) => r.moduleId);
}

/** True when the account owns (has purchased) the given module. */
export async function accountOwnsModule(ownerId: string, moduleId: string): Promise<boolean> {
  const row = await prisma.accountModule.findUnique({
    where: { ownerUserId_moduleId: { ownerUserId: ownerId, moduleId } },
    select: { id: true },
  });
  return row != null;
}
