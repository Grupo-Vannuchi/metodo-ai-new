import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getPurchaseOrder, purchaseFormOptions } from "@/lib/queries/purchases";
import { PurchaseForm } from "@/components/supplies/purchase-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditPurchasePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.purchases");
  const [order, options] = await Promise.all([
    getPurchaseOrder(ctx.organizationId, id),
    purchaseFormOptions(ctx.organizationId),
  ]);
  if (!order) notFound();
  // Only drafts are editable; otherwise send back to the detail view.
  if (order.status !== "DRAFT") redirect(`/${locale}/app/supplies/purchases/${id}`);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {t("editTitle")}
        {order.code ? <span className="ml-2 text-base font-normal text-muted-foreground">OC {order.code}</span> : null}
      </h1>
      <PurchaseForm options={options} initial={order} />
    </div>
  );
}
