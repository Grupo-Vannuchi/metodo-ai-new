import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getTemplate } from "@/lib/queries/campaigns";
import { TemplateEditForm } from "@/components/campaigns/template-edit-form";
import { type ChannelKey } from "@/lib/integrations/channels/meta";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("campaigns");

  const tpl = await getTemplate(ctx.organizationId, id);
  if (!tpl) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/app/campaigns/templates"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("editTemplate")}</h1>
      </div>

      <TemplateEditForm
        id={tpl.id}
        channel={tpl.channel as ChannelKey}
        name={tpl.name}
        subject={tpl.subject ?? ""}
        body={tpl.body}
      />
    </div>
  );
}
