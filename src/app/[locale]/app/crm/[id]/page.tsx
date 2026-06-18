import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getOpportunity, stageOptions } from "@/lib/queries/crm";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { OpportunityForm } from "@/components/crm/opportunity-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.opportunity");

  const [opp, stages, companies, contacts] = await Promise.all([
    getOpportunity(ctx.organizationId, id),
    stageOptions(ctx.organizationId),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
  ]);
  if (!opp) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("editTitle")}</h1>
      </div>

      <OpportunityForm
        id={opp.id}
        defaultValues={{
          title: opp.title,
          value: String(opp.value),
          stageId: opp.stageId,
          status: opp.status,
          companyId: opp.companyId ?? "",
          contactId: opp.contactId ?? "",
        }}
        stages={stages.stages}
        companies={companies}
        contacts={contacts}
      />
    </div>
  );
}
