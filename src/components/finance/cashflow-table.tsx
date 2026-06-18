import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import type { CashflowMonth } from "@/lib/queries/finance";

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

const money = (v: number, tone?: "in" | "out") =>
  cn("whitespace-nowrap px-4 py-3 text-right tabular-nums", tone === "in" && "text-green-600", tone === "out" && "text-red-600");

/** Cash-flow report (cash basis): realized in/out per month + running balance,
 * with projected (pending) amounts due in each month. */
export async function CashflowTable({ months }: { months: CashflowMonth[] }) {
  const t = await getTranslations("finance");

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">{t("cashflow.month")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("cashflow.in")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("cashflow.out")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("cashflow.result")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("cashflow.balance")}</th>
            <th className="px-4 py-3 text-right font-medium">{t("cashflow.projected")}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.key} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-4 py-3 font-medium capitalize">{monthLabel(m.key)}</td>
              <td className={money(m.income, "in")}>{formatBRL(m.income)}</td>
              <td className={money(m.expense, "out")}>{formatBRL(m.expense)}</td>
              <td className={cn(money(m.result), m.result >= 0 ? "text-green-600" : "text-red-600", "font-medium")}>
                {formatBRL(m.result)}
              </td>
              <td className={cn(money(m.cumulative), "font-semibold", m.cumulative >= 0 ? "text-foreground" : "text-red-600")}>
                {formatBRL(m.cumulative)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted-foreground">
                <span className="text-green-600">+{formatBRL(m.pendingIncome)}</span>{" "}
                <span className="text-red-600">−{formatBRL(m.pendingExpense)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
