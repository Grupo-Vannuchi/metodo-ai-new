import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getPipeline } from "@/lib/queries/pipelines";
import { PipelineSettings } from "@/components/crm/pipeline-settings";
import { StageManager } from "@/components/crm/stage-manager";
import { Link } from "@/i18n/navigation";
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
  const t = await getTranslations("crm.pipelines");

  const data = await getPipeline(ctx.organizationId, id);
  if (!data) notFound();
  const { pipeline, stages } = data;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/app/crm/pipelines"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{pipeline.name}</h1>
      </div>

      <PipelineSettings id={pipeline.id} name={pipeline.name} isDefault={pipeline.isDefault} />
      <StageManager pipelineId={pipeline.id} stages={stages} />
    </div>
  );
}
