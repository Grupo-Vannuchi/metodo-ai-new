import { getTranslations } from "next-intl/server";
import { Settings2, Plus, Package } from "lucide-react";
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
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.board");

  const pid = (await searchParams)?.pipeline;
  const [board, pipelines] = await Promise.all([
    getBoard(ctx.organizationId, pid),
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{board.pipelineName}</p>
        </div>
        <div className="flex items-center gap-2">
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
