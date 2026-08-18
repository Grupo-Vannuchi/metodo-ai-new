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
  Loader2,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { MODULES, MODULE_PRESETS, monthlyTotal } from "@/config/modules";
import { completeOnboarding, skipOnboarding } from "@/app/actions/modules";

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

export function OnboardingWizard({ orgName }: { orgName: string }) {
  const t = useTranslations("onboarding");
  const tl = useTranslations("loja");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const total = monthlyTotal([...selected]);

  function finish(fn: () => Promise<{ ok: boolean }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(tl("errGeneric"));
        return;
      }
      router.replace("/app");
    });
  }

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10 dark:bg-muted/20">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="text-center">
          <Logo className="mx-auto text-2xl" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight sm:text-3xl">{t("welcome", { org: orgName })}</h1>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">{t("subtitle")}</p>
        </div>

        {/* Quick start: pick a package (selects its modules). */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">{t("quickStart")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {MODULE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(new Set(p.modules))}
                className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-brand/50"
              >
                <span className="font-semibold">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.tagline}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Or pick module by module. */}
        <div>
          <p className="mb-2 text-sm font-semibold text-muted-foreground">{t("orPick")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODULES.map((m) => {
              const Icon = ICONS[m.icon] ?? Boxes;
              const on = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  aria-pressed={on}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                    on ? "border-brand bg-brand/5" : "border-border bg-card hover:border-brand/40",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl",
                      on ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {on ? <Check className="size-5" /> : <Icon className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{m.name}</span>
                      <span className="shrink-0 text-sm font-semibold">
                        {m.priceMonthly === 0 ? tl("free") : `${formatBRL(m.priceMonthly)}${tl("perMonth")}`}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{m.tagline}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">{error}</p> : null}

        {/* Footer: running total + actions. */}
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-lg">
          <div>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{t("total")}</span>
            <p className="text-xl font-bold text-brand">
              {formatBRL(total)}
              <span className="text-sm font-normal text-muted-foreground">{tl("perMonth")}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => finish(() => skipOnboarding())}>
              {t("skip")}
            </Button>
            <Button
              type="button"
              disabled={pending || selected.size === 0}
              onClick={() => finish(() => completeOnboarding([...selected]))}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("start")}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
