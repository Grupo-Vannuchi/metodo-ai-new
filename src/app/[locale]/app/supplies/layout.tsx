import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { hasFeature, type PlanKey } from "@/config/plans";
import { redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

/** Guard for /app/supplies: access-template (screen "supplies") + plan feature. */
export default async function SuppliesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "supplies", locale);
  if (!hasFeature(ctx.organization.plan as PlanKey, "supplies")) {
    redirect({ href: "/pricing", locale });
  }
  return <>{children}</>;
}
