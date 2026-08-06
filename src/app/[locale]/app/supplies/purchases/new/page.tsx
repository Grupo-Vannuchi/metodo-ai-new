import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { purchaseFormOptions } from "@/lib/queries/purchases";
import { PurchaseForm } from "@/components/supplies/purchase-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewPurchasePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.purchases");
  const options = await purchaseFormOptions(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
      <PurchaseForm options={options} />
    </div>
  );
}
