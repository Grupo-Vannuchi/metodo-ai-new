import { requireOrgContext } from "@/lib/tenant";
import { requireScreen, requireModule } from "@/lib/access";
import { DownloaderClient } from "@/components/downloader/downloader-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function DownloaderPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "downloader", locale);
  await requireModule(ctx, "downloader", locale);
  return <DownloaderClient />;
}
