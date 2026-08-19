"use client";

import { useState, useTransition } from "react";
import {
  Target,
  Wallet,
  Users,
  Package,
  Megaphone,
  MessageCircle,
  Sparkles,
  CheckSquare,
  Boxes,
  Check,
  Plus,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import {
  MODULES,
  MODULE_PRESETS,
  MODULE_BY_ID,
  monthlyTotal,
  type ModuleDef,
  type ModuleId,
} from "@/config/modules";
import { installModule, uninstallModule, applyPreset } from "@/app/actions/modules";

const ICONS: Record<string, LucideIcon> = {
  Target,
  Wallet,
  Users,
  Package,
  Megaphone,
  MessageCircle,
  Sparkles,
  CheckSquare,
};

/** Per-module visual identity for the featured banner. A real photo can replace
 *  the gradient later by dropping /public/modules/<id>.jpg and swapping the div. */
const THEME: Record<string, string> = {
  crm: "from-blue-500 to-indigo-600",
  finance: "from-emerald-500 to-teal-600",
  hr: "from-violet-500 to-purple-600",
  supplies: "from-amber-500 to-orange-600",
  marketing: "from-pink-500 to-rose-600",
  inbox: "from-sky-500 to-cyan-600",
  ia: "from-fuchsia-500 to-violet-600",
  tasks: "from-slate-500 to-slate-700",
};

type Tab = "modules" | "packages";

export function ModuleStore({ installed, canManage }: { installed: string[]; canManage: boolean }) {
  const t = useTranslations("loja");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("modules");

  const has = (id: string) => installed.includes(id);
  const total = monthlyTotal(installed);
  const priceLabel = (v: number) => (v === 0 ? t("free") : `${formatBRL(v)}${t("perMonth")}`);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusyId(id);
    start(async () => {
      const r = await fn();
      setBusyId(null);
      if (!r.ok) {
        setError(
          r.error === "has_dependent" ? t("errDependent") : r.error === "forbidden" ? t("errForbidden") : t("errGeneric"),
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Store header + running subscription total. */}
      <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border p-5 shadow-sm">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("yourSubscription")}</p>
          <p className="text-2xl font-bold text-brand">
            {formatBRL(total)}
            <span className="text-sm font-normal text-muted-foreground">{t("perMonth")}</span>
          </p>
        </div>
      </div>

      {!canManage ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {t("manageHint")}
        </p>
      ) : null}
      {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">{error}</p> : null}

      {/* Tabs: Modules · Packages */}
      <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {(["modules", "packages"] as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              tab === k ? "bg-brand text-brand-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(k === "modules" ? "tabModules" : "tabPackages")}
          </button>
        ))}
      </div>

      {tab === "modules" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <ModuleCard
              key={m.id}
              module={m}
              installed={has(m.id)}
              busy={busyId === m.id}
              disabled={pending}
              canManage={canManage}
              priceLabel={priceLabel(m.priceMonthly)}
              icon={ICONS[m.icon] ?? Boxes}
              onInstall={() => run(m.id, () => installModule(m.id))}
              onRemove={() => run(m.id, () => uninstallModule(m.id))}
              t={t}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {MODULE_PRESETS.map((p) => {
            const highlight = p.id === "completo";
            return (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col rounded-2xl border bg-card p-5 shadow-sm",
                  highlight ? "border-brand" : "border-border",
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  {highlight ? (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground">
                      {t("recommended")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
                <p className="mt-3 text-2xl font-bold">
                  {formatBRL(monthlyTotal(p.modules))}
                  <span className="text-sm font-normal text-muted-foreground">{t("perMonth")}</span>
                </p>
                <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm">
                  {p.modules.map((id) => (
                    <li key={id} className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-brand" />
                      <span className={has(id) ? "text-muted-foreground" : ""}>{MODULE_BY_ID[id as ModuleId].name}</span>
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <Button
                    type="button"
                    variant={highlight ? "primary" : "outline"}
                    className="mt-5"
                    disabled={pending}
                    onClick={() => run(`preset:${p.id}`, () => applyPreset(p.id))}
                  >
                    {busyId === `preset:${p.id}` ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    {t("applyPreset")}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModuleCard({
  module: m,
  installed,
  busy,
  disabled,
  canManage,
  priceLabel,
  icon: Icon,
  onInstall,
  onRemove,
  t,
}: {
  module: ModuleDef;
  installed: boolean;
  busy: boolean;
  disabled: boolean;
  canManage: boolean;
  priceLabel: string;
  icon: LucideIcon;
  onInstall: () => void;
  onRemove: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md",
        installed ? "border-brand/40" : "border-border",
      )}
    >
      {/* Featured banner — per-module gradient + icon (photo-ready). */}
      <div className={cn("relative flex h-28 items-center justify-center bg-gradient-to-br", THEME[m.id] ?? "from-slate-500 to-slate-700")}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{ background: "radial-gradient(120% 90% at 15% 10%, rgba(255,255,255,0.25), transparent 55%)" }}
        />
        <Icon className="size-11 text-white drop-shadow" />
        <span className="absolute right-3 top-3 rounded-full bg-black/25 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
          {priceLabel}
        </span>
        {installed ? (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-brand">
            <Check className="size-3" />
            {t("installed")}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-semibold">{m.name}</p>
        <p className="flex-1 text-sm text-muted-foreground">{m.tagline}</p>
        {canManage ? (
          installed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="mt-1 self-start text-muted-foreground hover:text-red-500"
              onClick={onRemove}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("remove")}
            </Button>
          ) : (
            <Button type="button" size="sm" className="mt-1 self-start" disabled={disabled} onClick={onInstall}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t("install")}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
