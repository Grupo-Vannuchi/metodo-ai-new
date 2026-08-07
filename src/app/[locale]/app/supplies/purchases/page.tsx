import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listPurchaseOrders, purchaseFormOptions } from "@/lib/queries/purchases";
import { PurchasesList } from "@/components/supplies/purchases-list";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.purchases");
  const [orders, options] = await Promise.all([
    listPurchaseOrders(ctx.organizationId),
    purchaseFormOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <PurchasesList orders={orders} options={options} />
    </div>
  );
}
