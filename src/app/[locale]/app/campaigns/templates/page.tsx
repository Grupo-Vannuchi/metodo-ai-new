import { getTranslations } from "next-intl/server";
import { Plus, Pencil } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listTemplates } from "@/lib/queries/campaigns";
import { deleteTemplate } from "@/app/actions/campaigns";
import { DeleteButton } from "@/components/crm/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { CHANNEL_META, type ChannelKey } from "@/lib/integrations/channels/meta";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("campaigns");

  const templates = await listTemplates(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("templates")}</h1>
        </div>
        <Link href="/app/campaigns/templates/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("newTemplate")}
        </Link>
      </div>

      {templates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("noTemplates")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("templateName")}</th>
                <th className="px-5 py-3 font-medium">{t("channel")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <tr key={tpl.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium">{tpl.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {CHANNEL_META[tpl.channel as ChannelKey]?.label ?? tpl.channel}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/app/campaigns/templates/${tpl.id}`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                        aria-label={t("edit")}
                      >
                        <Pencil className="size-4" />
                      </Link>
                      <DeleteButton action={deleteTemplate.bind(null, tpl.id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
