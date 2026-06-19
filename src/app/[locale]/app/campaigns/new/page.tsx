import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { templateOptions, audienceFacets } from "@/lib/queries/campaigns";
import { contactFolderOptions } from "@/lib/queries/contact-folders";
import { stageOptions } from "@/lib/queries/crm";
import { listMembers } from "@/lib/queries/organizations";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("campaigns");

  const [templates, folders, facets, { stages }, members] = await Promise.all([
    templateOptions(ctx.organizationId),
    contactFolderOptions(ctx.organizationId),
    audienceFacets(ctx.organizationId),
    stageOptions(ctx.organizationId),
    listMembers(ctx.organizationId),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
      {templates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
          {t("needTemplateFirst")}{" "}
          <Link href="/app/campaigns/templates/new" className="font-medium text-brand underline underline-offset-4">
            {t("createTemplate")}
          </Link>
        </p>
      ) : (
        <CampaignForm
          templates={templates}
          folders={folders}
          facets={facets}
          stages={stages}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
        />
      )}
    </div>
  );
}
