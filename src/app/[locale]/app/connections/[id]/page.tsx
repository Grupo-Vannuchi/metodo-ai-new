import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getConnection } from "@/lib/queries/connections";
import { EvolutionConnect } from "@/components/integrations/evolution-connect";
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

export default async function ConnectionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("connections");

  const conn = await getConnection(ctx.organizationId, id);
  if (!conn) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/app/connections"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{conn.label}</h1>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusStyles[conn.status])}>
            {t(`status.${conn.status}`)}
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">
          {PROVIDERS[conn.provider as IntegrationProviderKey]?.label ?? conn.provider}
        </p>
      </div>

      {conn.provider === "EVOLUTION" ? (
        <EvolutionConnect id={conn.id} initialActive={conn.status === "ACTIVE"} />
      ) : (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {t("detailNote")}
        </p>
      )}
    </div>
  );
}
