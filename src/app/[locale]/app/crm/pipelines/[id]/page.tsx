import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getPipeline } from "@/lib/queries/pipelines";
import { PipelineSettings } from "@/components/crm/pipeline-settings";
import { StageManager } from "@/components/crm/stage-manager";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ManagePipelinePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);

  const data = await getPipeline(ctx.organizationId, id);
  if (!data) notFound();
  const { pipeline, stages } = data;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{pipeline.name}</h1>
      </div>

      <PipelineSettings id={pipeline.id} name={pipeline.name} isDefault={pipeline.isDefault} />
      <StageManager pipelineId={pipeline.id} stages={stages} />
    </div>
  );
}
