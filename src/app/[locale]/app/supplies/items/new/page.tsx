import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { supplierOptions } from "@/lib/queries/supply-items";
import { registryOptions } from "@/lib/queries/registries";
import { ItemForm } from "@/components/supplies/item-form";
import { emptyItemForm } from "@/lib/supplies/item-form-values";
import { BackBar } from "@/components/app/back-bar";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewItemPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.items");
  const [suppliers, reg] = await Promise.all([
    supplierOptions(ctx.organizationId),
    registryOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <BackBar />
      <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
      <ItemForm
        defaults={emptyItemForm()}
        suppliers={suppliers}
        categories={reg.categories}
        units={reg.units}
        warehouses={reg.warehouses}
      />
    </div>
  );
}
