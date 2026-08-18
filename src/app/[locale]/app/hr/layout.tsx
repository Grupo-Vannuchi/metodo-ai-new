import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { hasFeatureByModules } from "@/config/modules";
import { HrNav } from "@/components/hr/hr-nav";
import { redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

/** Guard for /app/hr: screen-access (template) + plan feature (PLUS+). */
export default async function HrLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "hr", locale);
  if (!hasFeatureByModules(ctx.modules, "hr")) {
    redirect({ href: "/app/loja", locale });
  }

  return (
    <div className="flex flex-col gap-6">
      <HrNav />
      {children}
    </div>
  );
}
