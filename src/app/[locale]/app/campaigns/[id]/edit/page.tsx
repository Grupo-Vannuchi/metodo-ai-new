import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getCampaign, templateOptions } from "@/lib/queries/campaigns";
import { CampaignEditForm } from "@/components/campaigns/campaign-edit-form";
import { type ChannelKey } from "@/lib/integrations/channels/meta";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("campaigns");

  const data = await getCampaign(ctx.organizationId, id);
  if (!data) notFound();
  const { campaign } = data;

  const allTemplates = await templateOptions(ctx.organizationId);
  const templates = allTemplates
    .filter((tpl) => tpl.channel === campaign.channel)
    .map((tpl) => ({ id: tpl.id, name: tpl.name }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("editCampaign")}</h1>
      </div>

      <CampaignEditForm
        id={campaign.id}
        channel={campaign.channel as ChannelKey}
        name={campaign.name}
        templateId={campaign.templateId ?? ""}
        templates={templates}
      />
    </div>
  );
}
