import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { findDriveConnection, isDriveConfigured } from "@/lib/integrations/google-drive";
import { DriveConnect } from "@/components/files/drive-connect";
import { DriveBrowser } from "@/components/files/drive-browser";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function FilesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("files");
  const conn = await findDriveConnection(ctx.organizationId, ctx.userId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      {conn ? <DriveBrowser label={conn.label} /> : <DriveConnect configured={isDriveConfigured()} />}
    </div>
  );
}
