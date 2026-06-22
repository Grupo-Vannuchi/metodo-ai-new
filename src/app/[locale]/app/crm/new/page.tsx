import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { stageOptions, productServiceOptions } from "@/lib/queries/crm";
import { companyOptions } from "@/lib/queries/companies";
import { contactOptions } from "@/lib/queries/contacts";
import { listMembers } from "@/lib/queries/organizations";
import { NewOpportunityForm } from "@/components/crm/new-opportunity-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ pipeline?: string; contactId?: string; companyId?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.board");

  const { pipeline: pid, contactId, companyId } = await searchParams;
  const [stages, companies, contacts, rawMembers, productServices] = await Promise.all([
    stageOptions(ctx.organizationId, pid),
    companyOptions(ctx.organizationId),
    contactOptions(ctx.organizationId),
    listMembers(ctx.organizationId),
    productServiceOptions(ctx.organizationId),
  ]);

  const members = ctx.role === "MEMBER" ? rawMembers.filter(m => m.userId === ctx.userId) : rawMembers;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
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
        <NewOpportunityForm
          stages={stages.stages}
          companies={companies}
          contacts={contacts}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          productServices={productServices}
          initialContactId={contactId}
          initialCompanyId={companyId}
          isMemberRole={ctx.role === "MEMBER"}
        />
      )}
    </div>
  );
}
