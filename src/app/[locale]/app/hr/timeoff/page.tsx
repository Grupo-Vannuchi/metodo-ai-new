import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listTimeOff } from "@/lib/queries/time-off";
import { TIME_OFF_STATUS_FILTERS, type TimeOffStatusFilter } from "@/lib/validations/time-off";
import { TimeOffList } from "@/components/hr/time-off-list";
import { TimeOffToolbar } from "@/components/hr/time-off-toolbar";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function TimeOffPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const sp = await searchParams;
  const status = (
    TIME_OFF_STATUS_FILTERS.includes(sp?.status as TimeOffStatusFilter) ? sp!.status : "ALL"
  ) as TimeOffStatusFilter;

  const rows = await listTimeOff(ctx.organizationId, { status });
  // Only managers decide requests (they own the HR process).
  const canDecide = ctx.role === "OWNER" || ctx.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TimeOffToolbar status={status} />
        <Link href="/app/hr/timeoff/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("timeOff.new")}
        </Link>
      </div>

      <TimeOffList rows={rows} canDecide={canDecide} />
    </div>
  );
}
