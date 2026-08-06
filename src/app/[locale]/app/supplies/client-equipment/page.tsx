import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listServiceTickets, serviceFormOptions } from "@/lib/queries/service-tickets";
import { ClientEquipmentClient } from "@/components/supplies/client-equipment-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ClientEquipmentPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.clientEquipment");

  const [tickets, options] = await Promise.all([
    listServiceTickets(ctx.organizationId),
    serviceFormOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ClientEquipmentClient tickets={tickets} options={options} />
    </div>
  );
}
