import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Settings2, Package, Archive } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import {
  getBoard,
  BOARD_STATUS_FILTERS,
  BOARD_PERIOD_FILTERS,
  productServiceOptions,
  type BoardStatusFilter,
  type BoardPeriodFilter,
} from "@/lib/queries/crm";
import { pipelineOptions } from "@/lib/queries/pipelines";
import { listSavedViews } from "@/lib/queries/saved-views";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { listMembers } from "@/lib/queries/organizations";
import { Board } from "@/components/crm/board";
import { BoardToolbar } from "@/components/crm/board-toolbar";
import { SavedViews } from "@/components/crm/saved-views";
import { OpportunityList, type OpportunityRow } from "@/components/crm/opportunity-list";
import { OpportunityCreateProvider, OpportunityCreateButton } from "@/components/crm/opportunity-create";
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
  searchParams: Promise<{ pipeline?: string; owner?: string; status?: string; period?: string; view?: string; q?: string; from?: string; to?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.board");

  const sp = await searchParams;
  const mine = sp?.owner === "me";
  const status = (BOARD_STATUS_FILTERS.includes(sp?.status as BoardStatusFilter) ? sp!.status : "ACTIVE") as BoardStatusFilter;
  const period = (BOARD_PERIOD_FILTERS.includes(sp?.period as BoardPeriodFilter) ? sp!.period : "ALL") as BoardPeriodFilter;
  const view = sp?.view === "list" ? "list" : "kanban";
  const search = (sp?.q ?? "").trim().slice(0, 100);
  // Calendar date range (YYYY-MM-DD). Takes precedence over the legacy `period`.
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const fromStr = dateRe.test(sp?.from ?? "") ? sp!.from! : "";
  const toStr = dateRe.test(sp?.to ?? "") ? sp!.to! : "";
  const fromDate = fromStr ? new Date(`${fromStr}T00:00:00`) : undefined;
  const toDate = toStr ? new Date(`${toStr}T23:59:59.999`) : undefined;

  // Fall back to the last-opened funnel (cookie) when no explicit ?pipeline.
  const cookiePid = (await cookies()).get("crm_pipeline")?.value;
  const requestedPid = sp?.pipeline || cookiePid || undefined;

  const [board, pipelines, savedViews, companies, contacts, rawMembers, productServices] = await Promise.all([
    getBoard(ctx.organizationId, requestedPid, mine ? ctx.userId : undefined, { status, period, search, from: fromDate, to: toDate }),
    pipelineOptions(ctx.organizationId),
    listSavedViews(ctx.organizationId, ctx.userId, "crm"),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
    listMembers(ctx.organizationId),
    productServiceOptions(ctx.organizationId),
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
    if (fromStr) p.set("from", fromStr);
    if (toStr) p.set("to", toStr);
    else if (period !== "ALL") p.set("period", period);
    if (view !== "kanban") p.set("view", view);
    if (search) p.set("q", search);
    return p.toString();
  })();

  const createOptions = {
    stages: board.columns.map((c) => ({ id: c.id, name: c.name })),
    companies,
    contacts,
    members: (ctx.role === "MEMBER" ? rawMembers.filter((m) => m.userId === ctx.userId) : rawMembers).map((m) => ({
      id: m.userId,
      name: m.name,
    })),
    productServices,
    isMemberRole: ctx.role === "MEMBER",
  };

  return (
    // Fixed-height page so the board fills the viewport and its horizontal
    // scrollbar stays pinned at the bottom (instead of being pushed off-screen
    // when columns grow). Offset ≈ the app shell's padding (+ mobile header).
    <OpportunityCreateProvider options={createOptions}>
      <div className="flex h-[calc(100dvh-7rem)] flex-col gap-6 md:h-[calc(100dvh-4.5rem)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-muted-foreground">{board.pipelineName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <OpportunityCreateButton label={t("newOpportunity")} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <BoardToolbar
            pipelines={pipelines}
            current={{ pipelineId: board.pipelineId, owner: mine ? "me" : "all", status, from: fromStr, to: toStr, view, search }}
          />
          <SavedViews current={currentQuery} views={savedViews} />
        </div>

        {view === "list" ? <OpportunityList rows={rows} /> : <Board columns={board.columns} />}
      </div>
    </OpportunityCreateProvider>
  );
}
