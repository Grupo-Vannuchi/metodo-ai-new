import { requireOrgContext } from "@/lib/tenant";
import { accountOwnedModuleIds } from "@/lib/queries/accounts";
import { resolveLocale } from "@/i18n/routing";
import { BackgroundImage } from "@/components/layout/background-image";
import { ModuleStore } from "@/components/modules/module-store";

export const dynamic = "force-dynamic";

/** MetodoLoja — install/uninstall modules à la carte. Viewable by all; only
 *  OWNER/ADMIN can manage (it changes the bill). Purchases are account-level;
 *  installing an owned module in this company is free. */
export default async function LojaPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const canManage = ctx.role === "OWNER" || ctx.role === "ADMIN";
  // Modules the account has purchased — installable in any of its companies.
  const owned = ctx.accountOwnerId ? await accountOwnedModuleIds(ctx.accountOwnerId) : [];
  return (
    <>
      {/* Store backdrop: blurred corporate slideshow, like the login screen. */}
      <BackgroundImage className="opacity-60" />
      <ModuleStore installed={ctx.modules} owned={owned} canManage={canManage} />
    </>
  );
}
