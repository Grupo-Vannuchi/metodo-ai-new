import { requireOrgContext } from "@/lib/tenant";
import { requireScreen, requireModule } from "@/lib/access";
import { resolveLocale } from "@/i18n/routing";

/** Screen-access guard for /app/email and its sub-routes. */
export default async function EmailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "email", locale);
  await requireModule(ctx, "marketing", locale);
  return <>{children}</>;
}
