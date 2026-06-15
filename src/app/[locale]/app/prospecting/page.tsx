import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listExtractions } from "@/lib/queries/extractions";
import { NewExtraction } from "@/components/prospecting/new-extraction";
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

export default async function ProspectingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("prospecting");

  const jobs = await listExtractions(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <NewExtraction />

      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("colProvider")}</th>
                <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-5 py-3 font-medium">{t("colFound")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium">
                    {EXTRACTOR_META[j.provider as ExtractorProviderKey]?.label ?? j.provider}
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyles[j.status])}>
                      {t(`status.${j.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{j.totalFound}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/app/prospecting/${j.id}`}
                      className="text-sm font-medium text-brand underline underline-offset-4"
                    >
                      {t("view")}
                    </Link>
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
