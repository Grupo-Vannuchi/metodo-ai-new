import { requireOrgContext } from "@/lib/tenant";
import { MODULES, monthlyTotal } from "@/config/modules";
import { accountOwnedModuleIds } from "@/lib/queries/accounts";
import { SubscriptionManager, type BillingModule } from "@/components/settings/subscription-manager";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  // Billing is account-level: the modules PURCHASED by the account (not per company).
  // Only the account owner can cancel a module for the whole account.
  const canManage = ctx.isAccountOwner;
  const owned = ctx.accountOwnerId ? await accountOwnedModuleIds(ctx.accountOwnerId) : [];

  const modules: BillingModule[] = MODULES.filter((m) => owned.includes(m.id)).map((m) => {
    // Can't cancel while another OWNED module hard-depends on it.
    const blocker = MODULES.find((d) => owned.includes(d.id) && d.dependsOn.includes(m.id));
    return {
      id: m.id,
      name: m.name,
      tagline: m.tagline,
      category: m.category,
      icon: m.icon,
      priceMonthly: m.priceMonthly,
      blockedByName: blocker ? blocker.name : null,
    };
  });

  return (
    <SubscriptionManager
      modules={modules}
      total={monthlyTotal(owned)}
      canManage={canManage}
      orgName={ctx.organization.name}
    />
  );
}
