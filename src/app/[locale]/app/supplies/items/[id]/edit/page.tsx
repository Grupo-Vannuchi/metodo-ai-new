import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getSupplyItem, supplierOptions } from "@/lib/queries/supply-items";
import { registryOptions } from "@/lib/queries/registries";
import { ItemForm } from "@/components/supplies/item-form";
import { itemToForm } from "@/lib/supplies/item-form-values";
import { BackBar } from "@/components/app/back-bar";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.items");

  const [item, suppliers, reg] = await Promise.all([
    getSupplyItem(ctx.organizationId, id),
    supplierOptions(ctx.organizationId),
    registryOptions(ctx.organizationId),
  ]);
  if (!item) notFound();

  return (
    <div className="flex flex-col gap-6">
      <BackBar />
      <h1 className="text-2xl font-bold tracking-tight">{item.description}</h1>
      <ItemForm
        id={id}
        defaults={itemToForm(item)}
        suppliers={suppliers}
        categories={reg.categories}
        units={reg.units}
        warehouses={reg.warehouses}
      />
    </div>
  );
}
