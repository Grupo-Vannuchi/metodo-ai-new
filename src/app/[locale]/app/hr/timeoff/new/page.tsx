import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listEmployees } from "@/lib/queries/hr";
import { TimeOffForm } from "@/components/hr/time-off-form";
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
      <h1 className="text-2xl font-bold tracking-tight">{t("timeOff.newTitle")}</h1>
      <TimeOffForm employees={employees.map((e) => ({ id: e.id, name: e.name }))} />
    </div>
  );
}
