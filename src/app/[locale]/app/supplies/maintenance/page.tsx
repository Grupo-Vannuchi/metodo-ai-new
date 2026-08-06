import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listMaintenanceEvents, maintenanceFormOptions } from "@/lib/queries/maintenance";
import { MaintenanceClient } from "@/components/supplies/maintenance-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function MaintenancePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.maintenance");

  const [events, options] = await Promise.all([
    listMaintenanceEvents(ctx.organizationId),
    maintenanceFormOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <MaintenanceClient events={events} options={options} />
    </div>
  );
}
