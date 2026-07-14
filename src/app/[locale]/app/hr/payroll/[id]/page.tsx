import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getPayrollRun } from "@/lib/queries/payroll";
import { PayrollItems } from "@/components/hr/payroll-items";
import { PayrollRunActions } from "@/components/hr/payroll-run-actions";
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

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("hr");

  const run = await getPayrollRun(ctx.organizationId, id);
  if (!run) notFound();

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
  const competencia = `${String(run.month).padStart(2, "0")}/${run.year}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight tabular-nums">
              {t("payroll.runTitle", { competence: competencia })}
            </h1>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[run.status])}>
              {t(`payroll.status.${run.status}`)}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("payroll.payDateLabel", { date: fmtDate(run.payDate) })}
            {run.categoryName ? ` · ${run.categoryName}` : ""}
          </p>
        </div>
        <PayrollRunActions
          id={run.id}
          status={run.status}
          totalNet={run.totalNet}
        />
      </div>

      {run.status === "PAID" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Wallet className="size-4 text-green-600" />
              {t("payroll.paidTitle", { date: fmtDate(run.paidAt) })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("payroll.paidHint")}</p>
          </div>
          <Link href="/app/finance/entries" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("payroll.seeInFinance")}
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("payroll.earnings")}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatBRL(run.totalEarnings)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("payroll.deductions")}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums">− {formatBRL(run.totalDeductions)}</p>
        </div>
        <div className="rounded-xl border border-brand/30 bg-brand/5 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("payroll.totalNet")}
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-brand">{formatBRL(run.totalNet)}</p>
        </div>
      </div>

      {run.status === "DRAFT" ? (
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          {t("payroll.draftHint")}
        </p>
      ) : null}

      <PayrollItems items={run.items} editable={run.status === "DRAFT"} />

      <div>
        <Link href="/app/hr/payroll" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
