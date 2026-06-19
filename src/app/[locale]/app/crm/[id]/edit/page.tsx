import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getOpportunity, stageOptions, productServiceOptions } from "@/lib/queries/crm";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { listMembers } from "@/lib/queries/organizations";
import { OpportunityForm } from "@/components/crm/opportunity-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const dateStr = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default async function EditOpportunityPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.opportunity");

  const [opp, stages, companies, contacts, members, products] = await Promise.all([
    getOpportunity(ctx.organizationId, id),
    stageOptions(ctx.organizationId),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
    listMembers(ctx.organizationId),
    productServiceOptions(ctx.organizationId),
  ]);
  if (!opp) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("editTitle")}</h1>
        {opp.code ? <p className="mt-1 text-sm text-muted-foreground">{opp.code}</p> : null}
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
          productServiceId: opp.productServiceId ?? "",
          ownerId: opp.ownerId ?? "",
          expectedCloseDate: dateStr(opp.expectedCloseDate),
          notes: opp.notes ?? "",
          outcomeReason: opp.outcomeReason ?? "",
        }}
        stages={stages.stages}
        companies={companies}
        contacts={contacts}
        members={members.map((m) => ({ id: m.userId, name: m.name }))}
        productServices={products}
      />
    </div>
  );
}
