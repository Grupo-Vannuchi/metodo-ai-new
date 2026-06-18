import { getTranslations } from "next-intl/server";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { listAccessTemplates } from "@/lib/queries/access-templates";
import { AccessTemplatesManager } from "@/components/app/access-templates-manager";
import { GATEABLE_SCREENS } from "@/config/screens";
import { redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function AccessTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  if (!hasRole(ctx.role, "ADMIN")) redirect({ href: "/app/settings", locale });

  const t = await getTranslations("access");
  const rows = await listAccessTemplates(ctx.organizationId);
  const templates = rows.map((r) => ({
    id: r.id,
    name: r.name,
    screens: r.screens,
    memberCount: r._count.memberships,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">{t("subtitle")}</p>
      </div>

      <AccessTemplatesManager templates={templates} screens={[...GATEABLE_SCREENS]} />
    </div>
  );
}
