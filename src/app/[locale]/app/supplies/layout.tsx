import { Suspense } from "react";
import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { hasFeatureByModules } from "@/config/modules";
import { redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { SuppliesNav } from "@/components/supplies/supplies-nav";

/** Guard for /app/supplies: access-template (screen "supplies") + plan feature.
 *  Renders the single-workspace tab bar shared across all sections. */
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
  if (!hasFeatureByModules(ctx.modules, "supplies")) {
    redirect({ href: "/app", locale });
  }
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={null}>
        <SuppliesNav />
      </Suspense>
      {children}
    </div>
  );
}
