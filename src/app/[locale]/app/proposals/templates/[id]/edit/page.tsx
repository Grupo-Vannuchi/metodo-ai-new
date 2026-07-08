import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { proposalFormOptions } from "@/lib/queries/proposals";
import { getProposalTemplate } from "@/lib/queries/proposal-templates";
import { ProposalTemplateForm } from "@/components/proposals/proposal-template-form";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditProposalTemplatePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("proposalTemplates");

  const [options, template] = await Promise.all([
    proposalFormOptions(ctx.organizationId),
    getProposalTemplate(ctx.organizationId, id),
  ]);
  if (!template) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("editTitle")}</h1>
        <Link href="/app/proposals/templates" className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("back")}
        </Link>
      </div>
      <ProposalTemplateForm id={id} defaults={template} options={options} />
    </div>
  );
}
