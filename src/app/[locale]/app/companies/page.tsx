import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listCompanies } from "@/lib/queries/companies";
import { deleteCompany } from "@/app/actions/companies";
import { DeleteButton } from "@/components/crm/delete-button";
import { ExportButton } from "@/components/ui/export-button";
import { OpenRow } from "@/components/ui/open-row";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { Pagination } from "@/components/ui/pagination";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.companies");
  const page = parseInt((await searchParams)?.page || "1", 10);
  const pageSize = 10;

  const companies = await listCompanies(ctx.organizationId, page, pageSize);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton endpoint="/api/crm/export" params={{ entity: "companies" }} label={t("export")} />
          <Link href="/app/companies/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("new")}
          </Link>
        </div>
      </div>

      {companies.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="flex flex-col overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("name")}</th>
                <th className="px-5 py-3 font-medium">{t("cnpj")}</th>
                <th className="px-5 py-3 font-medium">{t("email")}</th>
                <th className="px-5 py-3 font-medium">{t("city")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {companies.data.map((c) => (
                <OpenRow
                  key={c.id}
                  href={`/app/companies/${c.id}`}
                  title={t("openHint")}
                  className="border-b border-border last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.cnpj ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{c.city || "—"}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <DeleteButton action={deleteCompany.bind(null, c.id)} />
                    </div>
                  </td>
                </OpenRow>
              ))}
            </tbody>
          </table>
          <Pagination total={companies.total} pageSize={pageSize} />
        </div>
      )}
    </div>
  );
}
