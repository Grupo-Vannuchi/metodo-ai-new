import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getExtraction } from "@/lib/queries/extractions";
import { ImportLeads } from "@/components/prospecting/import-leads";
import { EXTRACTOR_META, type ExtractorProviderKey } from "@/lib/integrations/extractors/meta";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  QUEUED: "bg-muted text-muted-foreground",
  RUNNING: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  DONE: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  CANCELED: "bg-muted text-muted-foreground",
};

export default async function ExtractionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("prospecting");

  const data = await getExtraction(ctx.organizationId, id);
  if (!data) notFound();
  const { job, leads } = data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/app/prospecting"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {EXTRACTOR_META[job.provider as ExtractorProviderKey]?.label ?? job.provider}
          </h1>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyles[job.status])}>
            {t(`status.${job.status}`)}
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">
          {t("foundCount", { count: job.totalFound })}
        </p>
        {job.error ? (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            {job.error}
          </p>
        ) : null}
      </div>

      <ImportLeads jobId={job.id} leads={leads} />
    </div>
  );
}
