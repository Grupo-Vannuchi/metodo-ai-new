import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { assetFormOptions } from "@/lib/queries/assets";
import { AssetForm } from "@/components/supplies/asset-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewAssetPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.assets");
  const options = await assetFormOptions(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/app/supplies/assets" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t("title")}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
      </div>
      <AssetForm options={options} />
    </div>
  );
}
