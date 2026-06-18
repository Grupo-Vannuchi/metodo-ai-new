import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getDre } from "@/lib/queries/finance";
import { DreTable } from "@/components/finance/dre-table";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const ymKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export default async function DrePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const { month } = await searchParams;

  const base =
    month && /^\d{4}-\d{2}$/.test(month)
      ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)
      : new Date();
  const from = new Date(base.getFullYear(), base.getMonth(), 1);
  const to = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const prev = new Date(base.getFullYear(), base.getMonth() - 1, 1);
  const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);

  const dre = await getDre(ctx.organizationId, from, to);
  const label = from.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const navCls = "rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-center gap-4">
        <Link href={`/app/finance/dre?month=${ymKey(prev)}`} aria-label="prev" className={navCls}>
          <ChevronLeft className="size-4" />
        </Link>
        <span className="min-w-40 text-center font-medium capitalize">{label}</span>
        <Link href={`/app/finance/dre?month=${ymKey(next)}`} aria-label="next" className={navCls}>
          <ChevronRight className="size-4" />
        </Link>
      </div>
      <DreTable dre={dre} />
    </div>
  );
}
