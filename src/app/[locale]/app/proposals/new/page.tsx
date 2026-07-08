import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { proposalFormOptions, proposalPrefillFromOpportunity } from "@/lib/queries/proposals";
import { listProposalTemplateOptions } from "@/lib/queries/proposal-templates";
import { ProposalForm, type ProposalFormDefaults } from "@/components/proposals/proposal-form";
import { ProposalTemplatePicker } from "@/components/proposals/proposal-template-picker";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ opportunity?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("proposals");

  const oppId = (await searchParams)?.opportunity;
  const [options, prefill, templates] = await Promise.all([
    proposalFormOptions(ctx.organizationId),
    oppId ? proposalPrefillFromOpportunity(ctx.organizationId, oppId) : Promise.resolve(null),
    listProposalTemplateOptions(ctx.organizationId),
  ]);

  const defaults: ProposalFormDefaults = {
    title: prefill?.title ?? "",
    opportunityId: prefill?.opportunityId ?? "",
    companyId: prefill?.companyId ?? "",
    contactId: prefill?.contactId ?? "",
    clientCompany: prefill?.clientCompany ?? "",
    clientName: prefill?.clientName ?? "",
    clientEmail: prefill?.clientEmail ?? "",
    clientPhone: prefill?.clientPhone ?? "",
    clientAddress: "",
    validUntil: "",
    intro: "",
    notes: "",
    status: "DRAFT",
    discount: 0,
    items: prefill?.item
      ? [
          {
            productServiceId: prefill.item.productServiceId,
            name: prefill.item.name,
            description: "",
            quantity: 1,
            unitPrice: prefill.item.unitPrice,
          },
        ]
      : [],
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("form.newTitle")}</h1>
        <Link href="/app/proposals" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("back")}
        </Link>
      </div>
      <ProposalTemplatePicker templates={templates} opportunityId={oppId} />
      <ProposalForm defaults={defaults} options={options} />
    </div>
  );
}
