import { getTranslations, getLocale } from "next-intl/server";
import {
  ShoppingCart,
  Tag,
  Wrench,
  AlertTriangle,
  Bookmark,
  CalendarClock,
  Coins,
  PackageOpen,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getSupplyIndicators } from "@/lib/queries/supply-indicators";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Tone = "default" | "danger" | "warn";

function Tile({
  href,
  label,
  value,
  sub,
  tone = "default",
  icon: Icon,
}: {
  href?: string;
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  icon?: typeof ShoppingCart;
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {Icon ? <Icon className={cn("size-4", tone === "default" ? "text-muted-foreground" : toneCls)} /> : null}
      </div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", toneCls)}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </>
  );
  const base = "block rounded-xl border border-border bg-card p-4";
  return href ? (
    <Link href={href} className={cn(base, "hover-lift hover:border-brand/40")}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}

/** Supplies module home: cross-module indicators (navigation lives in the tab bar). */
export default async function SuppliesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies");
  const tk = await getTranslations("supplies.kpi");
  const intlLocale = await getLocale();
  const ind = await getSupplyIndicators(ctx.organizationId);

  const brl = new Intl.NumberFormat(intlLocale, { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const nf = new Intl.NumberFormat(intlLocale);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{tk("title")}</h2>
        <div className="stagger-children grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            href="/app/supplies/stock"
            icon={AlertTriangle}
            label={tk("belowMin")}
            value={nf.format(ind.stock.belowMin)}
            sub={tk("belowMinSub")}
            tone={ind.stock.belowMin > 0 ? "danger" : "default"}
          />
          <Tile href="/app/supplies/stock" icon={Coins} label={tk("stockValue")} value={brl.format(ind.stock.totalValue)} />
          <Tile
            href="/app/supplies/stock"
            icon={Bookmark}
            label={tk("reservations")}
            value={nf.format(ind.stock.reservations)}
            sub={tk("reservationsSub")}
          />
          <Tile
            href="/app/supplies/purchases"
            icon={ShoppingCart}
            label={tk("openPurchases")}
            value={nf.format(ind.purchases.openCount)}
            sub={brl.format(ind.purchases.openValue)}
          />
          <Tile
            href="/app/supplies/assets"
            icon={Tag}
            label={tk("assets")}
            value={nf.format(ind.assets.total)}
            sub={tk("assetsSub", { inUse: ind.assets.inUse, available: ind.assets.available })}
          />
          <Tile
            href="/app/supplies/assets"
            icon={Coins}
            label={tk("assetValue")}
            value={brl.format(ind.assets.totalValue)}
          />
          <Tile
            href="/app/supplies/maintenance"
            icon={Wrench}
            label={tk("overdue")}
            value={nf.format(ind.maintenance.overdue)}
            sub={tk("overdueSub")}
            tone={ind.maintenance.overdue > 0 ? "danger" : "default"}
          />
          <Tile
            href="/app/supplies/maintenance"
            icon={CalendarClock}
            label={tk("upcoming")}
            value={nf.format(ind.maintenance.upcoming30)}
            sub={tk("upcomingSub")}
            tone={ind.maintenance.upcoming30 > 0 ? "warn" : "default"}
          />
          <Tile
            href="/app/supplies/client-equipment"
            icon={PackageOpen}
            label={tk("inHouse")}
            value={nf.format(ind.clientEquipment.inHouse)}
            sub={tk("inHouseSub")}
          />
        </div>
      </section>
    </div>
  );
}
