import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getPurchaseOrder } from "@/lib/queries/purchases";
import { PurchaseDetail } from "@/components/supplies/purchase-detail";
import { Link } from "@/i18n/navigation";
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
  const t = await getTranslations("supplies.purchases");
  const order = await getPurchaseOrder(ctx.organizationId, id);
  if (!order) notFound();

  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/supplies/purchases" className="text-sm text-muted-foreground hover:text-foreground">
        ← {t("title")}
      </Link>
      <PurchaseDetail order={order} />
    </div>
  );
}
