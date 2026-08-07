import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import {
  getStockBalances,
  listStockMovements,
  stockFormOptions,
  listReservations,
  reservationFormOptions,
} from "@/lib/queries/stock";
import { StockClient } from "@/components/supplies/stock-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ move?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("supplies.stock");
  const initialMove = (await searchParams)?.move ?? null;

  const [balances, movements, options, reservations, reservationOptions] = await Promise.all([
    getStockBalances(ctx.organizationId),
    listStockMovements(ctx.organizationId, { limit: 200 }),
    stockFormOptions(ctx.organizationId),
    listReservations(ctx.organizationId),
    reservationFormOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <StockClient
        balances={balances}
        movements={movements}
        options={options}
        reservations={reservations}
        reservationOptions={reservationOptions}
        initialMove={initialMove}
      />
    </div>
  );
}
