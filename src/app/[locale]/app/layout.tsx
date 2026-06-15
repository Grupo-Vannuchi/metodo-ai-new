import { setRequestLocale } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { AppShell } from "@/components/app/app-shell";
import { resolveLocale } from "@/i18n/routing";

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

  return (
    <AppShell ctx={ctx} locale={locale}>
      {children}
    </AppShell>
  );
}
