"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { AudiencePreview } from "@/lib/email-broadcast/types";

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={muted ? "flex justify-between gap-3 text-muted-foreground" : "flex justify-between gap-3"}>
      <dt>{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** The arithmetic of the send (selected − repeats − blocked − invalid = total) and the quota bar. */
export function AudienceSummary({
  preview,
  quota,
  children,
}: {
  preview: AudiencePreview | null;
  quota: { used: number; limit: number };
  children?: React.ReactNode;
}) {
  const t = useTranslations("emailBroadcast.summary");
  const format = useFormatter();
  const s = preview?.stats;
  const pct = Math.min(100, (quota.used / quota.limit) * 100);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold">{t("title")}</h2>
      {s ? (
        <dl className="flex flex-col gap-2 text-sm tabular-nums">
          <Row label={t("selected")} value={format.number(s.selected)} />
          <Row muted label={`− ${t("duplicates")}`} value={format.number(s.duplicates)} />
          <Row muted label={`− ${t("suppressed")}`} value={format.number(s.suppressed)} />
          <Row muted label={`− ${t("invalid")}`} value={format.number(s.invalid)} />
          <div className="my-1 h-px bg-border" />
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-semibold">{t("total")}</dt>
            <dd className="text-2xl font-bold text-brand">
              {format.number(s.total)} <span className="text-sm font-medium text-muted-foreground">{t("unique")}</span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{t("counting")}</p>
      )}

      {preview && preview.sample.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-brand">{t("viewList")}</summary>
          <ul className="mt-2 max-h-60 overflow-y-auto">
            {preview.sample.map((r) => (
              <li key={r.email} className="flex justify-between gap-3 py-1">
                <span className="truncate">{r.name ?? r.email}</span>
                {r.name ? <span className="truncate text-muted-foreground">{r.email}</span> : null}
              </li>
            ))}
          </ul>
          {s && s.total > preview.sample.length ? (
            <p className="mt-1 text-xs text-muted-foreground">{t("sampleNote", { count: preview.sample.length })}</p>
          ) : null}
        </details>
      ) : null}

      <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3">
        <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{t("quota")}</span>
          <span>
            {format.number(quota.used)} / {format.number(quota.limit)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {children}
    </section>
  );
}
