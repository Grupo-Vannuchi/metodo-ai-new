import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listSupplyItems, supplierOptions } from "@/lib/queries/supply-items";
import { registryOptions } from "@/lib/queries/registries";
import { ItemsList } from "@/components/supplies/items-list";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ItemsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.items");
  const [items, suppliers, reg] = await Promise.all([
    listSupplyItems(ctx.organizationId),
    supplierOptions(ctx.organizationId),
    registryOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ItemsList
        items={items}
        suppliers={suppliers}
        categories={reg.categories}
        units={reg.units}
        warehouses={reg.warehouses}
      />
    </div>
  );
}
