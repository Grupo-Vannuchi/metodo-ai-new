import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getPurchaseOrder } from "@/lib/queries/purchases";
import { hasFeatureByModules } from "@/config/modules";
import { PurchaseDetail } from "@/components/supplies/purchase-detail";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const order = await getPurchaseOrder(ctx.organizationId, id);
  if (!order) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PurchaseDetail order={order} hasFinance={hasFeatureByModules(ctx.modules, "finance")} />
    </div>
  );
}
