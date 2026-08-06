import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getAsset, assetFormOptions } from "@/lib/queries/assets";
import { AssetForm } from "@/components/supplies/asset-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditAssetPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const [asset, options] = await Promise.all([getAsset(ctx.organizationId, id), assetFormOptions(ctx.organizationId)]);
  if (!asset) notFound();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{asset.name}</h1>
      <AssetForm options={options} initial={asset} />
    </div>
  );
}
