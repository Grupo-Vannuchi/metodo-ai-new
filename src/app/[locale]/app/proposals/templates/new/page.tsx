import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { proposalFormOptions } from "@/lib/queries/proposals";
import { emptyDocument } from "@/lib/validations/proposal-template";
import type { ProposalTemplateDetail } from "@/lib/queries/proposal-templates";
import { ProposalTemplateForm } from "@/components/proposals/proposal-template-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewProposalTemplatePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("proposalTemplates");

  const options = await proposalFormOptions(ctx.organizationId);
  const defaults: ProposalTemplateDetail = {
    id: "",
    name: "",
    document: emptyDocument(),
    validityDays: null,
    discount: 0,
    items: [],
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
      <ProposalTemplateForm defaults={defaults} options={options} />
    </div>
  );
}
