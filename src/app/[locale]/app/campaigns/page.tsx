import { getTranslations } from "next-intl/server";
import { Plus, FileText } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listCampaigns } from "@/lib/queries/campaigns";
import { deleteCampaign } from "@/app/actions/campaigns";
import { DeleteButton } from "@/components/crm/delete-button";
import { buttonVariants } from "@/components/ui/button";
import { CHANNEL_META, type ChannelKey } from "@/lib/integrations/channels/meta";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SCHEDULED: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  RUNNING: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  DONE: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  CANCELED: "bg-muted text-muted-foreground",
};

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("campaigns");

  const campaigns = await listCampaigns(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/campaigns/templates" className={buttonVariants({ variant: "outline" })}>
            <FileText className="size-4" />
            {t("templates")}
          </Link>
          <Link href="/app/campaigns/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("new")}
          </Link>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("campaignName")}</th>
                <th className="px-5 py-3 font-medium">{t("channel")}</th>
                <th className="px-5 py-3 font-medium">{t("recipients")}</th>
                <th className="px-5 py-3 font-medium">{t("status")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/app/campaigns/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {CHANNEL_META[c.channel as ChannelKey]?.label ?? c.channel}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{c._count.recipients}</td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyles[c.status])}>
                      {t(`statusLabel.${c.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <DeleteButton action={deleteCampaign.bind(null, c.id)} />
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
