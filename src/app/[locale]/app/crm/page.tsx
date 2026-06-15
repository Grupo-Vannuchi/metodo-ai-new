import { getTranslations } from "next-intl/server";
import { Settings2 } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getBoard, stageOptions } from "@/lib/queries/crm";
import { pipelineOptions } from "@/lib/queries/pipelines";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { Board } from "@/components/crm/board";
import { NewOpportunity } from "@/components/crm/new-opportunity";
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

  const [stages, companies, contacts] = await Promise.all([
    stageOptions(ctx.organizationId, board.pipelineId),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{board.pipelineName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/app/crm/pipelines" className={buttonVariants({ variant: "outline" })}>
            <Settings2 className="size-4" />
            {t("managePipelines")}
          </Link>
          <NewOpportunity stages={stages.stages} companies={companies} contacts={contacts} />
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
