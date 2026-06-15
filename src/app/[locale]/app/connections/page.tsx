import { getTranslations } from "next-intl/server";
import { Plus, Check } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listConnections } from "@/lib/queries/connections";
import { deleteConnection } from "@/app/actions/connections";
import { DeleteButton } from "@/components/crm/delete-button";
import { TestButton } from "@/components/integrations/test-button";
import { buttonVariants } from "@/components/ui/button";
import { PROVIDERS, type IntegrationProviderKey } from "@/lib/integrations/registry";
import { isPlatformConfigured } from "@/lib/integrations/platform";
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
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("connections");

  const connections = await listConnections(ctx.organizationId);

  // Platform-managed integrations that work with no setup (within plan quota).
  const managed = [
    { key: "cnpj", ready: true },
    { key: "google", ready: isPlatformConfigured("GOOGLE") },
    { key: "email", ready: isPlatformConfigured("RESEND") },
  ].filter((m) => m.ready);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/app/connections/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("new")}
        </Link>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{t("managedTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("managedHint")}</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {managed.map((m) => (
            <li
              key={m.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-green-50 px-3 py-1 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300"
            >
              <Check className="size-3.5" />
              {t(`managed.${m.key}`)}
            </li>
          ))}
        </ul>
      </section>

      <h2 className="text-sm font-semibold text-muted-foreground">{t("ownTitle")}</h2>

      {connections.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
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
                  <td className="px-5 py-3 font-medium">{c.label}</td>
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
