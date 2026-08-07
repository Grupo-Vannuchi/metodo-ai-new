"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Search, Tag, Wrench } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ASSET_STATUSES, assetStatusCls } from "@/components/supplies/asset-status";
import type { AssetRow } from "@/lib/queries/assets";

export function AssetsList({ assets }: { assets: AssetRow[] }) {
  const t = useTranslations("supplies.assets");
  const tmaint = useTranslations("supplies.maintenance");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("ALL");

  const tabs = ["ALL", ...ASSET_STATUSES];
  const term = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      assets.filter((a) => {
        if (status !== "ALL" && a.status !== status) return false;
        if (!term) return true;
        return [a.name, a.code, a.serialNumber, a.itemName, a.ownerCompanyName, a.location].some((x) =>
          (x ?? "").toLowerCase().includes(term),
        );
      }),
    [assets, status, term],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm focus-visible:border-brand focus-visible:outline-none"
          />
        </div>
        <Link href="/app/supplies/assets/new" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-4" />
          {t("new")}
        </Link>
      </div>

      <div className="flex flex-wrap gap-1">
        {tabs.map((skey) => (
          <button
            key={skey}
            type="button"
            onClick={() => setStatus(skey)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              status === skey ? "bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {skey === "ALL" ? t("all") : t(`status.${skey}`)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {assets.length === 0 ? t("empty") : t("noResults")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((a) => (
            <li key={a.id} className="flex items-stretch gap-1.5">
              <Link
                href={`/app/supplies/assets/${a.id}/edit`}
                className={cn(
                  "hover-lift flex flex-1 items-center gap-3 rounded-lg border border-border bg-card p-3 hover:border-brand/40",
                  !a.active && "opacity-60",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Tag className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{a.name}</span>
                    {a.code ? <span className="text-xs text-muted-foreground">{a.code}</span> : null}
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", assetStatusCls[a.status])}>
                      {t(`status.${a.status}`)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span>{t(`nature.${a.nature}`)}</span>
                    {a.serialNumber ? <span>S/N {a.serialNumber}</span> : null}
                    {a.itemName ? <span>{a.itemName}</span> : null}
                    {a.ownerCompanyName ? <span>{a.ownerCompanyName}</span> : null}
                    {a.location ? <span>{a.location}</span> : null}
                  </span>
                </span>
              </Link>
              <Link
                href={{ pathname: "/app/supplies/maintenance", query: { asset: a.id } }}
                title={tmaint("schedule")}
                aria-label={tmaint("schedule")}
                className="flex shrink-0 items-center justify-center rounded-lg border border-border bg-card px-3 text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand"
              >
                <Wrench className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
