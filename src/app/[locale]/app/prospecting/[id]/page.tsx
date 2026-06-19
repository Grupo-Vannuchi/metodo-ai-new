import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getExtractionJob } from "@/lib/queries/extractions";
import { stageOptions } from "@/lib/queries/crm";
import { ImportLeads } from "@/components/prospecting/import-leads";
import { ExtractionPoller } from "@/components/prospecting/extraction-poller";
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

function queryLabel(query: unknown): string {
  const q = (query ?? {}) as Record<string, string>;
  return [q.nome, q.segmento, q.localidade, q.cnpj].filter(Boolean).join(" · ") || "—";
}

export default async function ExtractionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("prospecting");

  const [data, { stages }] = await Promise.all([
    getExtractionJob(ctx.organizationId, id),
    stageOptions(ctx.organizationId),
  ]);
  if (!data) notFound();
  const { job, leads } = data;
  const running = job.status === "QUEUED" || job.status === "RUNNING";

  return (
    <div className="flex flex-col gap-6">
      <ExtractionPoller active={running} />
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{queryLabel(job.query)}</h1>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyles[job.status])}>
            {t(`status.${job.status}`)}
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">{t("foundCount", { count: job.total })}</p>
      </div>

      {job.status === "FAILED" ? (
        <p className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {t(`error.${job.error ?? "unknown"}`)}
        </p>
      ) : null}

      {leads.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {running ? t("running") : t("noLeads")}
        </p>
      ) : (
        <ImportLeads jobId={job.id} leads={leads} stages={stages} />
      )}
    </div>
  );
}
