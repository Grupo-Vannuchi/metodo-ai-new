import { getTranslations } from "next-intl/server";
import {
  Check,
  Target,
  Wallet,
  Users,
  Package,
  Megaphone,
  MessageCircle,
  Sparkles,
  CheckSquare,
  Boxes,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { MODULES, MODULE_PRESETS, MODULE_BY_ID, monthlyTotal, type ModuleId } from "@/config/modules";

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

/** Marketing showcase of the MetodoLoja: ready-made packages + the full module
 *  catalog with à-la-carte prices. Replaces PlansGrid on the landing + pricing. */
export async function ModulesGrid() {
  const t = await getTranslations("pricing");
  const tl = await getTranslations("loja");
  const price = (v: number) => (v === 0 ? tl("free") : `${formatBRL(v)}${tl("perMonth")}`);

  return (
    <div className="flex flex-col gap-12">
      {/* Ready-made packages */}
      <div>
        <h3 className="mb-5 text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("packages")}
        </h3>
        <div className="grid gap-6 md:grid-cols-3">
          {MODULE_PRESETS.map((p) => {
            const highlight = p.id === "completo";
            return (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col rounded-2xl border bg-card p-6",
                  highlight ? "border-brand shadow-md" : "border-border",
                )}
              >
                {highlight ? (
                  <span className="mb-2 inline-flex w-fit rounded-full bg-brand px-3 py-0.5 text-xs font-medium text-brand-foreground">
                    {t("recommended")}
                  </span>
                ) : null}
                <h4 className="text-lg font-semibold">{p.name}</h4>
                <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
                <p className="mt-4 text-2xl font-bold">
                  {formatBRL(monthlyTotal(p.modules))}
                  <span className="text-sm font-normal text-muted-foreground">{tl("perMonth")}</span>
                </p>
                <ul className="mt-5 flex flex-1 flex-col gap-2 text-sm">
                  {p.modules.map((id) => (
                    <li key={id} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                      <span>{MODULE_BY_ID[id as ModuleId].name}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={cn("mt-6", buttonVariants({ variant: highlight ? "primary" : "outline", size: "lg" }))}
                >
                  {t("cta")}
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full à-la-carte catalog */}
      <div>
        <h3 className="text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("catalog")}</h3>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">{t("baseNote")}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => {
            const Icon = ICONS[m.icon] ?? Boxes;
            return (
              <div key={m.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-sm font-semibold">{price(m.priceMonthly)}</span>
                </div>
                <p className="mt-1 font-semibold">{m.name}</p>
                <p className="text-xs text-muted-foreground">{m.tagline}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
