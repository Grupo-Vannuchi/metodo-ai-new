import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import type { Dre } from "@/lib/queries/finance";

function Lines({
  title,
  lines,
  total,
  tone,
  emptyLabel,
}: {
  title: string;
  lines: { categoryName: string; total: number }[];
  total: number;
  tone: "in" | "out";
  emptyLabel: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</div>
      <div className="divide-y divide-border">
        {lines.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          lines.map((l, i) => (
            <div key={`${l.categoryName}-${i}`} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{l.categoryName}</span>
              <span className={cn("tabular-nums", tone === "in" ? "text-green-600" : "text-red-600")}>
                {formatBRL(l.total)}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm font-semibold">
        <span>{title}</span>
        <span className={cn("tabular-nums", tone === "in" ? "text-green-600" : "text-red-600")}>
          {formatBRL(total)}
        </span>
      </div>
    </div>
  );
}

/** DRE — income − expense grouped by category (accrual basis), for a period. */
export async function DreTable({ dre }: { dre: Dre }) {
  const t = await getTranslations("finance");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Lines
          title={t("nav.income")}
          lines={dre.income}
          total={dre.totalIncome}
          tone="in"
          emptyLabel={t("dre.noIncome")}
        />
        <Lines
          title={t("nav.expense")}
          lines={dre.expense}
          total={dre.totalExpense}
          tone="out"
          emptyLabel={t("dre.noExpense")}
        />
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-4">
        <span className="font-semibold">{t("dre.result")}</span>
        <span className={cn("text-lg font-bold tabular-nums", dre.result >= 0 ? "text-green-600" : "text-red-600")}>
          {formatBRL(dre.result)}
        </span>
      </div>
    </div>
  );
}
