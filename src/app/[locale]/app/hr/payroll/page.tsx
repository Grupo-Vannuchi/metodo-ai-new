import { getTranslations } from "next-intl/server";
import { Plus, Receipt } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listPayrollRuns } from "@/lib/queries/payroll";
import { OpenRow } from "@/components/ui/open-row";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  APPROVED: "bg-brand/10 text-brand",
  PAID: "bg-green-500/10 text-green-600",
};

export default async function PayrollPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const runs = await listPayrollRuns(ctx.organizationId);
  const fmtDate = (d: Date) => new Date(d).toLocaleDateString("pt-BR");
  const competencia = (year: number, month: number) => `${String(month).padStart(2, "0")}/${year}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("payroll.hint")}</p>
        <Link href="/app/hr/payroll/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("payroll.new")}
        </Link>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Receipt className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">{t("payroll.empty")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("payroll.colCompetence")}</th>
                <th className="px-5 py-3 font-medium">{t("payroll.colStatus")}</th>
                <th className="px-5 py-3 font-medium">{t("payroll.colEmployees")}</th>
                <th className="px-5 py-3 font-medium">{t("payroll.colPayDate")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("payroll.colNet")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <OpenRow
                  key={r.id}
                  href={`/app/hr/payroll/${r.id}`}
                  title={t("openHint")}
                  className="border-b border-border last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3 font-medium tabular-nums">{competencia(r.year, r.month)}</td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[r.status])}>
                      {t(`payroll.status.${r.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{r.employeeCount}</td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDate(r.payDate)}</td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-brand">
                    {formatBRL(r.totalNet)}
                  </td>
                </OpenRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
