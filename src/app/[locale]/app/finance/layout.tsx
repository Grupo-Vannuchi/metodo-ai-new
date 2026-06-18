import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { hasFeature, type PlanKey } from "@/config/plans";
import { FinanceNav } from "@/components/finance/finance-nav";
import { redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

/** Guard for /app/finance: screen-access (template) + plan feature (PLUS+). */
export default async function FinanceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "finance", locale);
  if (!hasFeature(ctx.organization.plan as PlanKey, "finance")) {
    redirect({ href: "/pricing", locale });
  }

  return (
    <div className="flex flex-col gap-6">
      <FinanceNav />
      {children}
    </div>
  );
}
