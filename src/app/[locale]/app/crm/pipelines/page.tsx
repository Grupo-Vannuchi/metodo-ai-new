import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listPipelines } from "@/lib/queries/pipelines";
import { NewPipelineForm } from "@/components/crm/new-pipeline-form";
import { PipelineRow } from "@/components/crm/pipeline-row";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function PipelinesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.pipelines");

  const pipelines = await listPipelines(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <NewPipelineForm />

      {pipelines.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          {pipelines.map((p) => (
            <PipelineRow
              key={p.id}
              id={p.id}
              name={p.name}
              isDefault={p.isDefault}
              stageCount={p._count.stages}
            />
          ))}
        </div>
      )}
    </div>
  );
}
