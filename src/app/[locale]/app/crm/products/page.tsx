import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listProductServices } from "@/lib/queries/crm";
import { ProductsManager } from "@/components/crm/products-manager";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.products");

  const items = await listProductServices(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <ProductsManager items={items} />
    </div>
  );
}
