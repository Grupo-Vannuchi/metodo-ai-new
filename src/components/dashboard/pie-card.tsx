"use client";

import { useCallback, useEffect, useState } from "react";
import { ChartPie } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatBRL } from "@/lib/money";
import { PieChart } from "@/components/dashboard/pie-chart";
import { useRealtime } from "@/components/app/realtime-provider";

type RawSlice = { key: string; value: number };
type Loaded = { model: string; slices: RawSlice[] };

const COLORS = ["#18375d", "#2ecc71", "#5b8fc7", "#f39c12", "#9b59b6", "#e74c3c", "#1abc9c", "#7f8c8d"];
const SOURCE_KEY: Record<string, string> = { manual: "manual", "extractor:google": "prospecting", import: "import" };
const CURRENCY_MODELS = new Set(["value_by_stage", "finance_by_type"]);

export function PieCard({ models, defaultModel }: { models: string[]; defaultModel: string }) {
  const t = useTranslations("app.dashboard.pie");
  const [model, setModel] = useState(defaultModel);
  // Keep the loaded slices tied to the model they came from, so labels are never
  // resolved with the wrong (stale) model while a new selection is fetching.
  const [loaded, setLoaded] = useState<Loaded>({ model: defaultModel, slices: [] });
  const [loading, setLoading] = useState(true);

  // Reload when the selected model changes.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (active) setLoading(true);
      try {
        const r = await fetch(`/api/dashboard/pie?model=${model}`, { cache: "no-store" });
        if (active && r.ok) setLoaded({ model, slices: await r.json() });
      } catch {
        /* ignore */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [model]);

  // Keep the chart fresh as the underlying data changes (no loading flicker).
  const refetch = useCallback(() => {
    fetch(`/api/dashboard/pie?model=${model}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLoaded({ model, slices: d }))
      .catch(() => {});
  }, [model]);
  useRealtime("crm", refetch);
  useRealtime("tasks", refetch);

  // Everything below renders the *loaded* model, not the pending selection.
  const activeModel = loaded.model;
  const isCurrency = CURRENCY_MODELS.has(activeModel);
  const fmt = (n: number) => (isCurrency ? formatBRL(n) : String(n));
  // Compact form for the donut centre so large currency totals don't overflow.
  const fmtCompact = (n: number) =>
    new Intl.NumberFormat("pt-BR", {
      ...(isCurrency ? { style: "currency" as const, currency: "BRL" } : {}),
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);

  // Resolve a message but fall back to the raw key if it is missing — guards
  // against unexpected enum values (and any transient model/data mismatch).
  const tr = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);

  function labelFor(key: string): string {
    if (key === "__none__") return t("none");
    switch (activeModel) {
      case "opps_by_status":
        return tr(`status.${key}`, key);
      case "tasks_by_priority":
        return tr(`priority.${key}`, key);
      case "finance_by_type":
        return tr(`finance.${key}`, key);
      case "contacts_by_source": {
        const k = SOURCE_KEY[key];
        return k ? tr(`source.${k}`, key) : key;
      }
      default:
        return key;
    }
  }

  const data = loaded.slices.map((s, i) => ({ label: labelFor(s.key), value: s.value, color: COLORS[i % COLORS.length] }));
  const total = data.reduce((a, d) => a + d.value, 0);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ChartPie className="size-4 text-brand" />
          {t("title")}
        </h2>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-9 max-w-52 rounded-lg border border-border bg-card px-2.5 text-sm focus-visible:border-brand focus-visible:outline-none"
        >
          {models.map((m) => (
            <option key={m} value={m}>
              {t(`model.${m}`)}
            </option>
          ))}
        </select>
      </div>

      {loading && data.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">…</p>
      ) : data.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            <PieChart data={data} />
            <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
              <span className="max-w-full truncate text-base font-bold tabular-nums" title={fmt(total)}>
                {fmtCompact(total)}
              </span>
              <span className="text-[11px] text-muted-foreground">{t("total")}</span>
            </div>
          </div>
          <ul className="flex w-full flex-1 flex-col gap-2">
            {data.map((d, i) => (
              <li key={`${d.label}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                <span className="shrink-0 tabular-nums font-medium">{fmt(d.value)}</span>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {total > 0 ? Math.round((d.value / total) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
