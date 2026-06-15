import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getBoard, stageOptions } from "@/lib/queries/crm";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { Board } from "@/components/crm/board";
import { NewOpportunity } from "@/components/crm/new-opportunity";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function CrmPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.board");

  const [board, stages, companies, contacts] = await Promise.all([
    getBoard(ctx.organizationId),
    stageOptions(ctx.organizationId),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
  ]);

  if (!board) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("noPipeline")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{board.pipelineName}</p>
        </div>
        <NewOpportunity stages={stages.stages} companies={companies} contacts={contacts} />
      </div>

      <Board columns={board.columns} />
    </div>
  );
}
