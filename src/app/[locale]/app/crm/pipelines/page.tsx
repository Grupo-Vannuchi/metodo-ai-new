import { getTranslations } from "next-intl/server";
import { ArrowLeft, Star, ChevronRight } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listPipelines } from "@/lib/queries/pipelines";
import { NewPipelineForm } from "@/components/crm/new-pipeline-form";
import { Link } from "@/i18n/navigation";
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
        <Link
          href="/app/crm"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("backBoard")}
        </Link>
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
            <Link
              key={p.id}
              href={`/app/crm/pipelines/${p.id}`}
              className="flex items-center justify-between border-b border-border px-5 py-4 transition-colors last:border-0 hover:bg-muted/40"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.isDefault ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                    <Star className="size-3" />
                    {t("isDefault")}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{t("stageCount", { n: p._count.stages })}</span>
                <ChevronRight className="size-4" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
