import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getCampaign } from "@/lib/queries/campaigns";
import { StartButton } from "@/components/campaigns/start-button";
import { CHANNEL_META, type ChannelKey } from "@/lib/integrations/channels/meta";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const campaignStatusStyles: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SCHEDULED: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  RUNNING: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  DONE: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  CANCELED: "bg-muted text-muted-foreground",
};

const recipientStatusStyles: Record<string, string> = {
  PENDING: "text-muted-foreground",
  SENT: "text-blue-600",
  DELIVERED: "text-green-600",
  READ: "text-green-700",
  FAILED: "text-red-600",
};

const COUNT_KEYS = ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"] as const;

export default async function CampaignDetailPage({
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
  const { campaign, counts, recipients } = data;
  const canStart = campaign.status === "DRAFT" || campaign.status === "PAUSED";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/app/campaigns"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("back")}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", campaignStatusStyles[campaign.status])}>
              {t(`statusLabel.${campaign.status}`)}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {CHANNEL_META[campaign.channel as ChannelKey]?.label ?? campaign.channel}
          </p>
        </div>
        {canStart ? <StartButton id={campaign.id} /> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {COUNT_KEYS.map((key) => (
          <div key={key} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{t(`recipientStatus.${key}`)}</p>
            <p className="mt-1 text-xl font-semibold">{counts[key] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">{t("colContact")}</th>
              <th className="px-5 py-3 font-medium">{t("colDestination")}</th>
              <th className="px-5 py-3 font-medium">{t("status")}</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-5 py-3 font-medium">{r.name}</td>
                <td className="px-5 py-3 text-muted-foreground">{r.destination}</td>
                <td className="px-5 py-3">
                  <span className={cn("text-xs font-medium", recipientStatusStyles[r.status])}>
                    {t(`recipientStatus.${r.status}`)}
                  </span>
                  {r.error ? <span className="ml-2 text-xs text-red-500">{r.error}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
