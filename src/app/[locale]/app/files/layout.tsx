import { requireOrgContext } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { resolveLocale } from "@/i18n/routing";

/** Guard for /app/files: access-template gating (screen "files"). */
export default async function FilesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "files", locale);
  return <>{children}</>;
}
