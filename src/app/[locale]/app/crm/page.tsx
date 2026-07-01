import { getTranslations } from "next-intl/server";
import { Settings2, Plus, Package, Archive } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getBoard } from "@/lib/queries/crm";
import { pipelineOptions } from "@/lib/queries/pipelines";
import { Board } from "@/components/crm/board";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CrmPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ pipeline?: string; owner?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.board");

  const sp = await searchParams;
  const pid = sp?.pipeline;
  const mine = sp?.owner === "me";
  const [board, pipelines] = await Promise.all([
    getBoard(ctx.organizationId, pid, mine ? ctx.userId : undefined),
    pipelineOptions(ctx.organizationId),
  ]);

  if (!board) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-muted-foreground">{t("noPipeline")}</p>
          <Link href="/app/crm/pipelines" className={cn("mt-4", buttonVariants())}>
            {t("createFunnel")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    // Fixed-height page so the board fills the viewport and its horizontal
    // scrollbar stays pinned at the bottom (instead of being pushed off-screen
    // when columns grow). Offset ≈ the app shell's padding (+ mobile header).
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-6 md:h-[calc(100dvh-4.5rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{board.pipelineName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border p-0.5">
            <Link
              href={`/app/crm${board.pipelineId ? `?pipeline=${board.pipelineId}` : ""}`}
              className={cn("rounded-md px-3 py-1 text-sm transition-colors", !mine ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t("allDeals")}
            </Link>
            <Link
              href={`/app/crm?owner=me${board.pipelineId ? `&pipeline=${board.pipelineId}` : ""}`}
              className={cn("rounded-md px-3 py-1 text-sm transition-colors", mine ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t("myDeals")}
            </Link>
          </div>
          <Link href="/app/crm/closed" className={buttonVariants({ variant: "outline" })}>
            <Archive className="size-4" />
            {t("closedLink")}
          </Link>
          <Link href="/app/crm/products" className={buttonVariants({ variant: "outline" })}>
            <Package className="size-4" />
            {t("productsLink")}
          </Link>
          <Link href="/app/crm/pipelines" className={buttonVariants({ variant: "outline" })}>
            <Settings2 className="size-4" />
            {t("managePipelines")}
          </Link>
          <Link href={`/app/crm/new?pipeline=${board.pipelineId}`} className={buttonVariants()}>
            <Plus className="size-4" />
            {t("newOpportunity")}
          </Link>
        </div>
      </div>

      {pipelines.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {pipelines.map((p) => (
            <Link
              key={p.id}
              href={`/app/crm?pipeline=${p.id}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                p.id === board.pipelineId
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      <Board columns={board.columns} />
    </div>
  );
}
