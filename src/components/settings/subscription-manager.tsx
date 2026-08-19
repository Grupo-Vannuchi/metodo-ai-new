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
  Plus,
  Loader2,
  Lock,
  Trash2,
  Store,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { uninstallModule } from "@/app/actions/modules";
import type { ModuleCategory } from "@/config/modules";

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

/** Per-module gradient (mirrors the store banner) for a consistent identity. */
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

export type BillingModule = {
  id: string;
  name: string;
  tagline: string;
  category: ModuleCategory;
  icon: string;
  priceMonthly: number;
  /** Name of an installed module that hard-depends on this one (blocks removal). */
  blockedByName: string | null;
};

/**
 * The org's subscription: the running monthly total and every installed module
 * with its price, plus inline removal (OWNER/ADMIN). Adding modules happens in
 * the Loja — this screen manages what's already subscribed.
 */
export function SubscriptionManager({
  modules,
  total,
  canManage,
  orgName,
}: {
  modules: BillingModule[];
  total: number;
  canManage: boolean;
  orgName: string;
}) {
  const t = useTranslations("settings.billing");
  const tc = useTranslations("loja.category");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const priceLabel = (v: number) => (v === 0 ? t("free") : `${formatBRL(v)}${t("perMonth")}`);

  function remove(mod: BillingModule) {
    setError(null);
    confirm({
      title: t("removeTitle", { name: mod.name }),
      description: t("removeDesc"),
      confirmLabel: t("remove"),
      variant: "danger",
    }).then((ok) => {
      if (!ok) return;
      setBusyId(mod.id);
      start(async () => {
        const r = await uninstallModule(mod.id);
        setBusyId(null);
        if (!r.ok) {
          setError(r.error === "has_dependent" ? t("errDependent") : r.error === "forbidden" ? t("errForbidden") : t("errGeneric"));
          return;
        }
        router.refresh();
      });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Summary */}
      <div className="glass relative overflow-hidden rounded-2xl border border-border p-6 shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(110% 110% at 100% 0%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 55%)" }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("summaryFor", { org: orgName })}</p>
            <p className="mt-1 text-3xl font-bold text-brand">
              {formatBRL(total)}
              <span className="text-base font-normal text-muted-foreground">{t("perMonth")}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{t("moduleCount", { count: modules.length })}</p>
          </div>
          <Link href="/app/loja" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
            <Store className="size-4" />
            {t("goToStore")}
          </Link>
        </div>
      </div>

      {!canManage ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{t("manageHint")}</p>
      ) : null}
      {error ? <p className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">{error}</p> : null}

      {/* Installed modules */}
      {modules.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-10 text-center">
          <Boxes className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <Link href="/app/loja" className={cn(buttonVariants({ size: "sm" }), "gap-2")}>
            <Plus className="size-4" />
            {t("addModules")}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {modules.map((m) => {
            const Icon = ICONS[m.icon] ?? Boxes;
            const busy = busyId === m.id;
            return (
              <div key={m.id} className="glass flex items-center gap-4 rounded-xl border border-border p-4 shadow-sm">
                <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", THEME[m.id] ?? "from-slate-500 to-slate-700")}>
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{m.name}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{tc(m.category)}</span>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{m.tagline}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">{priceLabel(m.priceMonthly)}</p>
                </div>
                {canManage ? (
                  m.blockedByName ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground"
                      title={t("blockedBy", { name: m.blockedByName })}
                    >
                      <Lock className="size-4" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(m)}
                      aria-label={t("remove")}
                      title={t("remove")}
                      className="inline-flex shrink-0 items-center rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </button>
                  )
                ) : null}
              </div>
            );
          })}

          {canManage ? (
            <Link
              href="/app/loja"
              className="glass flex items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm font-medium text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand"
            >
              <Plus className="size-4" />
              {t("addModules")}
            </Link>
          ) : null}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("simulatedNote")}</p>
    </div>
  );
}
