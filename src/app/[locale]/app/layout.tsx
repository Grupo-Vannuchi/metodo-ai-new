import { setRequestLocale } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { AppShell } from "@/components/app/app-shell";
import { resolveLocale } from "@/i18n/routing";
import { redirect } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  setRequestLocale(locale);

  // Security boundary: redirects to /login when there is no valid tenant context.
  const ctx = await requireOrgContext(locale);

  // First run: the owner of a brand-new org sets up their Método (picks modules)
  // before entering the app. Onboarding lives outside /app, so no redirect loop.
  if (!ctx.onboarded && ctx.role === "OWNER") {
    redirect({ href: "/onboarding", locale });
  }

  return (
    <AppShell ctx={ctx} locale={locale}>
      {children}
    </AppShell>
  );
}
