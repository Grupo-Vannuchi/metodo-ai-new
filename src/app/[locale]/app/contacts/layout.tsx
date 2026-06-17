import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { resolveLocale } from "@/i18n/routing";

/** Screen-access guard for /app/contacts and its sub-routes. */
export default async function ScreenLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "contacts", locale);
  return <>{children}</>;
}
