import { getTranslations } from "next-intl/server";
import { Plus, FileText, Pencil } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listProposalTemplates } from "@/lib/queries/proposal-templates";
import { OpenRow } from "@/components/ui/open-row";
import { buttonVariants } from "@/components/ui/button";
import { DeleteTemplateButton } from "@/components/proposals/delete-template-button";
import { UseTemplateButton } from "@/components/proposals/use-template-button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ProposalTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("proposalTemplates");

  const templates = await listProposalTemplates(ctx.organizationId);
  const fmtDate = (d: Date) => new Date(d).toLocaleDateString("pt-BR");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/app/proposals" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("backToProposals")}
          </Link>
          <Link href="/app/proposals/templates/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("new")}
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("colName")}</th>
                <th className="px-5 py-3 font-medium">{t("colSections")}</th>
                <th className="px-5 py-3 font-medium">{t("colItems")}</th>
                <th className="px-5 py-3 font-medium">{t("colValidity")}</th>
                <th className="px-5 py-3 font-medium">{t("colUpdated")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <OpenRow
                  key={tpl.id}
                  href={`/app/proposals/templates/${tpl.id}/edit`}
                  title={t("openHint")}
                  className="border-b border-border align-middle last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3 font-medium">{tpl.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{tpl.sectionCount}</td>
                  <td className="px-5 py-3 text-muted-foreground">{tpl.itemCount}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {tpl.validityDays != null ? t("daysCount", { count: tpl.validityDays }) : "—"}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{fmtDate(tpl.updatedAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <UseTemplateButton id={tpl.id} />
                      <Link
                        href={`/app/proposals/templates/${tpl.id}/edit`}
                        title={t("edit")}
                        aria-label={t("edit")}
                        className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </Link>
                      <DeleteTemplateButton id={tpl.id} name={tpl.name} />
                    </div>
                  </td>
                </OpenRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
