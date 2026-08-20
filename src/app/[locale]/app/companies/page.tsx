import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getCompaniesBoard } from "@/lib/queries/company-folders";
import { findCompanyDuplicates } from "@/lib/queries/duplicates";
import { ExportButton } from "@/components/ui/export-button";
import { CompaniesGrid } from "@/components/crm/companies-grid";
import { CsvImport } from "@/components/crm/csv-import";
import { DuplicatesModal } from "@/components/crm/duplicates-modal";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.companies");

  const [{ columns }, dupes] = await Promise.all([
    getCompaniesBoard(ctx.organizationId),
    findCompanyDuplicates(ctx.organizationId),
  ]);
  const total = columns.reduce((n, c) => n + c.companies.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {dupes.length > 0 ? <DuplicatesModal entity="companies" groups={dupes} /> : null}
          <CsvImport entity="companies" />
          <ExportButton endpoint="/api/crm/export" params={{ entity: "companies" }} label={t("export")} />
          <Link href="/app/companies/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("new")}
          </Link>
        </div>
      </div>

      {total === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <CompaniesGrid columns={columns} />
      )}
    </div>
  );
}
