import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getProposal, proposalFormOptions } from "@/lib/queries/proposals";
import { ProposalForm, type ProposalFormDefaults } from "@/components/proposals/proposal-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditProposalPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("proposals");

  const [proposal, options] = await Promise.all([
    getProposal(ctx.organizationId, id),
    proposalFormOptions(ctx.organizationId),
  ]);
  if (!proposal) notFound();

  const toDateInput = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

  const defaults: ProposalFormDefaults = {
    title: proposal.title,
    opportunityId: proposal.opportunityId ?? "",
    companyId: proposal.companyId ?? "",
    contactId: proposal.contactId ?? "",
    clientCompany: proposal.clientCompany ?? "",
    clientName: proposal.clientName ?? "",
    clientEmail: proposal.clientEmail ?? "",
    clientPhone: proposal.clientPhone ?? "",
    clientAddress: proposal.clientAddress ?? "",
    validUntil: toDateInput(proposal.validUntil),
    intro: proposal.intro ?? "",
    notes: proposal.notes ?? "",
    status: proposal.status,
    discount: proposal.discount,
    items: proposal.items.map((it) => ({
      productServiceId: it.productServiceId ?? "",
      name: it.name,
      description: it.description ?? "",
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("form.editTitle")}</h1>
      <ProposalForm id={id} defaults={defaults} options={options} />
    </div>
  );
}
