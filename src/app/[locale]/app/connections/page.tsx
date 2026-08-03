import { getTranslations } from "next-intl/server";
import { Plus, HardDrive } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { isDriveConfigured } from "@/lib/integrations/google-drive";
import { listConnections } from "@/lib/queries/connections";
import { listMembers } from "@/lib/queries/organizations";
import { deleteConnection } from "@/app/actions/connections";
import { DeleteButton } from "@/components/crm/delete-button";
import { TestButton } from "@/components/integrations/test-button";
import { buttonVariants } from "@/components/ui/button";
import { PROVIDERS, type IntegrationProviderKey } from "@/lib/integrations/registry";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  INACTIVE: "bg-muted text-muted-foreground",
  ERROR: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("connections");
  const sp = await searchParams;
  const driveConnected = sp.connected === "drive";
  const driveError = typeof sp.error === "string" && sp.error.startsWith("drive_");

  // Members see only the WhatsApp number they connected; OWNER/ADMIN see all
  // connections (with the owning member's name).
  const canSeeAll = ctx.role !== "MEMBER";
  const connections = await listConnections(
    ctx.organizationId,
    canSeeAll ? undefined : { ownerId: ctx.userId },
  );
  const members = canSeeAll ? await listMembers(ctx.organizationId) : [];
  const ownerName = new Map(members.map((m) => [m.userId, m.name]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {isDriveConfigured() ? (
            // Full navigation to the OAuth start route (not an app page) — Link/client nav can't do the server redirect.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/api/integrations/google-drive/connect" className={buttonVariants({ variant: "outline" })}>
              <HardDrive className="size-4" />
              {t("connectDrive")}
            </a>
          ) : null}
          <Link href="/app/connections/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("new")}
          </Link>
        </div>
      </div>

      {driveConnected ? (
        <p className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-2.5 text-sm text-green-700 dark:text-green-300">
          {t("driveConnected")}
        </p>
      ) : driveError ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          {t("driveError")}
        </p>
      ) : null}

      {connections.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("colLabel")}</th>
                <th className="px-5 py-3 font-medium">{t("colProvider")}</th>
                <th className="px-5 py-3 font-medium">{t("colStatus")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/app/connections/${c.id}`} className="hover:underline">
                      {c.label}
                    </Link>
                    {canSeeAll && c.ownerId ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {ownerName.get(c.ownerId) ?? "—"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {PROVIDERS[c.provider as IntegrationProviderKey]?.label ?? c.provider}
                  </td>
                  <td className="px-5 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyles[c.status])}>
                      {t(`status.${c.status}`)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <TestButton id={c.id} />
                      <DeleteButton action={deleteConnection.bind(null, c.id)} />
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
