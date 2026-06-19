import { getTranslations } from "next-intl/server";
import { formatBRL } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { EntityFinance } from "@/lib/queries/finance";

/** Per-client finance summary shown on the contact/company view. */
export async function EntityFinanceCard({ data }: { data: EntityFinance }) {
  const t = await getTranslations("finance");

  const kpis = [
    { label: t("status.SETTLED.INCOME"), value: data.received, tone: "text-green-600" },
    { label: t("kpi.receivable"), value: data.receivable, tone: "text-foreground" },
    { label: t("kpi.payable"), value: data.payable, tone: "text-red-600" },
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{t("clientFinanceTitle")}</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label}>
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className={cn("mt-0.5 font-semibold tabular-nums", k.tone)}>{formatBRL(k.value)}</p>
          </div>
        ))}
      </div>

      {data.recent.length > 0 ? (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {data.recent.map((e) => (
            <li key={e.id}>
              <Link
                href={`/app/finance/entries/${e.id}`}
                className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted"
              >
                <span className="truncate">{e.description}</span>
                <span className={cn("shrink-0 tabular-nums", e.type === "INCOME" ? "text-green-600" : "text-red-600")}>
                  {e.type === "INCOME" ? "+" : "−"} {formatBRL(e.amount)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </section>
  );
}
