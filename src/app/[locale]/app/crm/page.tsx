import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Settings2, Plus, Package, Archive, BarChart3 } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import {
  getBoard,
  BOARD_STATUS_FILTERS,
  BOARD_PERIOD_FILTERS,
  type BoardStatusFilter,
  type BoardPeriodFilter,
} from "@/lib/queries/crm";
import { pipelineOptions } from "@/lib/queries/pipelines";
import { listSavedViews } from "@/lib/queries/saved-views";
import { Board } from "@/components/crm/board";
import { BoardToolbar } from "@/components/crm/board-toolbar";
import { SavedViews } from "@/components/crm/saved-views";
import { OpportunityList, type OpportunityRow } from "@/components/crm/opportunity-list";
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
  searchParams: Promise<{ pipeline?: string; owner?: string; status?: string; period?: string; view?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.board");

  const sp = await searchParams;
  const mine = sp?.owner === "me";
  const status = (BOARD_STATUS_FILTERS.includes(sp?.status as BoardStatusFilter) ? sp!.status : "ACTIVE") as BoardStatusFilter;
  const period = (BOARD_PERIOD_FILTERS.includes(sp?.period as BoardPeriodFilter) ? sp!.period : "ALL") as BoardPeriodFilter;
  const view = sp?.view === "list" ? "list" : "kanban";

  // Fall back to the last-opened funnel (cookie) when no explicit ?pipeline.
  const cookiePid = (await cookies()).get("crm_pipeline")?.value;
  const requestedPid = sp?.pipeline || cookiePid || undefined;

  const [board, pipelines, savedViews] = await Promise.all([
    getBoard(ctx.organizationId, requestedPid, mine ? ctx.userId : undefined, { status, period }),
    pipelineOptions(ctx.organizationId),
    listSavedViews(ctx.organizationId, ctx.userId, "crm"),
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

  const rows: OpportunityRow[] =
    view === "list"
      ? board.columns.flatMap((c) => c.cards.map((card) => ({ ...card, stageName: c.name })))
      : [];

  // The querystring for the filters currently in effect — what "save view" stores.
  const currentQuery = (() => {
    const p = new URLSearchParams();
    if (board.pipelineId) p.set("pipeline", board.pipelineId);
    if (mine) p.set("owner", "me");
    if (status !== "ACTIVE") p.set("status", status);
    if (period !== "ALL") p.set("period", period);
    if (view !== "kanban") p.set("view", view);
    return p.toString();
  })();

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
          <Link href="/app/crm/reports" className={buttonVariants({ variant: "outline" })}>
            <BarChart3 className="size-4" />
            {t("reportsLink")}
          </Link>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <BoardToolbar
          pipelines={pipelines}
          current={{ pipelineId: board.pipelineId, owner: mine ? "me" : "all", status, period, view }}
        />
        <SavedViews current={currentQuery} views={savedViews} />
      </div>

      {view === "list" ? <OpportunityList rows={rows} /> : <Board columns={board.columns} />}
    </div>
  );
}
