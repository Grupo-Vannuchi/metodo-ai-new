import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { stageOptions } from "@/lib/queries/crm";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { NewOpportunityForm } from "@/components/crm/new-opportunity-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ pipeline?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.board");

  const pid = (await searchParams)?.pipeline;
  const [stages, companies, contacts] = await Promise.all([
    stageOptions(ctx.organizationId, pid),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/app/crm"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("newOpportunity")}</h1>
      </div>

      {stages.stages.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
          {t("noStages")}{" "}
          <Link href="/app/crm/pipelines" className="font-medium text-brand underline underline-offset-4">
            {t("managePipelines")}
          </Link>
        </p>
      ) : (
        <NewOpportunityForm stages={stages.stages} companies={companies} contacts={contacts} />
      )}
    </div>
  );
}
