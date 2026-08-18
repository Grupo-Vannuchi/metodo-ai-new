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
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import {
  MODULES,
  MODULE_PRESETS,
  monthlyTotal,
  type ModuleCategory,
  type ModuleDef,
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

const CATEGORY_ORDER: ModuleCategory[] = ["comercial", "operacao", "atendimento", "ia", "produtividade"];

export function ModuleStore({ installed, canManage }: { installed: string[]; canManage: boolean }) {
  const t = useTranslations("loja");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const has = (id: string) => installed.includes(id);
  const total = monthlyTotal(installed);

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

  const price = (m: ModuleDef) => (m.priceMonthly === 0 ? t("free") : `${formatBRL(m.priceMonthly)}${t("perMonth")}`);

  return (
    <div className="flex flex-col gap-6">
      {/* Header + subscription summary */}
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

      {/* Presets (the old plans, reborn as packages) */}
      {canManage ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t("presets")}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {MODULE_PRESETS.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
                <p className="font-semibold">{p.name}</p>
                <p className="flex-1 text-xs text-muted-foreground">{p.tagline}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(`preset:${p.id}`, () => applyPreset(p.id))}
                >
                  {busyId === `preset:${p.id}` ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {t("applyPreset")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Modules by category */}
      {CATEGORY_ORDER.map((cat) => {
        const mods = MODULES.filter((m) => m.category === cat);
        if (mods.length === 0) return null;
        return (
          <section key={cat}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t(`category.${cat}`)}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mods.map((m) => {
                const Icon = ICONS[m.icon] ?? Boxes;
                const installedNow = has(m.id);
                const busy = busyId === m.id;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors",
                      installedNow ? "border-brand/40" : "border-border",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl",
                          installedNow ? "bg-brand/10 text-brand" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{m.name}</p>
                          {installedNow ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                              <Check className="size-3" />
                              {t("installed")}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{m.tagline}</p>
                      </div>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{price(m)}</span>
                      {canManage ? (
                        installedNow ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            className="text-muted-foreground hover:text-red-500"
                            onClick={() => run(m.id, () => uninstallModule(m.id))}
                          >
                            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                            {t("remove")}
                          </Button>
                        ) : (
                          <Button type="button" size="sm" disabled={pending} onClick={() => run(m.id, () => installModule(m.id))}>
                            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                            {t("install")}
                          </Button>
                        )
                      ) : (
                        <span className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "pointer-events-none opacity-60")}>
                          {installedNow ? t("installed") : t("notInstalled")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
