import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listEmployees } from "@/lib/queries/hr";
import { TimeOffForm } from "@/components/hr/time-off-form";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewTimeOffPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  // Terminated people can't request time off.
  const employees = await listEmployees(ctx.organizationId, { status: "ACTIVE" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("timeOff.newTitle")}</h1>
        <Link href="/app/hr/timeoff" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("back")}
        </Link>
      </div>
      <TimeOffForm employees={employees.map((e) => ({ id: e.id, name: e.name }))} />
    </div>
  );
}
