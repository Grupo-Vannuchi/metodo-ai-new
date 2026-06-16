import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listExtractionJobs } from "@/lib/queries/extractions";
import { listConnections } from "@/lib/queries/connections";
import { NewExtraction } from "@/components/prospecting/new-extraction";
import { deleteExtraction } from "@/app/actions/extractions";
import { DeleteButton } from "@/components/crm/delete-button";
import { buttonVariants } from "@/components/ui/button";
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

function queryLabel(query: unknown): string {
  const q = (query ?? {}) as Record<string, string>;
  return [q.nome, q.segmento, q.localidade, q.cnpj].filter(Boolean).join(" · ") || "—";
}

export default async function ProspectingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("prospecting");

  const [jobs, connections] = await Promise.all([
    listExtractionJobs(ctx.organizationId),
    listConnections(ctx.organizationId),
  ]);
  const hasGoogle = connections.some((c) => c.provider === "GOOGLE");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      {!hasGoogle ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          {t("needConnection")}{" "}
          <Link href="/app/connections/new" className="font-medium underline underline-offset-2">
            {t("connectGoogle")}
          </Link>
        </div>
      ) : (
        <NewExtraction />
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        {t("lgpdNotice")}
      </p>

      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("colQuery")}</th>
                <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-5 py-3 font-medium">{t("colFound")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/app/prospecting/${job.id}`} className="hover:underline">
                      {queryLabel(job.query)}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyles[job.status])}>
                      {t(`status.${job.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{job.total}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/app/prospecting/${job.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                        {t("view")}
                      </Link>
                      <DeleteButton action={deleteExtraction.bind(null, job.id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
