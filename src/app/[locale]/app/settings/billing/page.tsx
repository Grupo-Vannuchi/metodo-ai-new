import { requireOrgContext, hasRole } from "@/lib/tenant";
import { MODULES, monthlyTotal } from "@/config/modules";
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
  const canManage = hasRole(ctx.role, "ADMIN");
  const installed = ctx.modules;

  const modules: BillingModule[] = MODULES.filter((m) => installed.includes(m.id)).map((m) => {
    // A module can't be removed while another installed module hard-depends on it.
    const blocker = MODULES.find((d) => installed.includes(d.id) && d.dependsOn.includes(m.id));
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
      total={monthlyTotal(installed)}
      canManage={canManage}
      orgName={ctx.organization.name}
    />
  );
}
