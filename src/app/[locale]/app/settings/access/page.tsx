import { requireOrgContext, hasRole } from "@/lib/tenant";
import { listAccessTemplates } from "@/lib/queries/access-templates";
import { AccessTemplatesManager } from "@/components/app/access-templates-manager";
import { GATEABLE_SCREENS } from "@/config/screens";
import { availableScreens } from "@/config/modules";
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

  const rows = await listAccessTemplates(ctx.organizationId);
  const templates = rows.map((r) => ({
    id: r.id,
    name: r.name,
    screens: r.screens,
    memberCount: r._count.memberships,
  }));

  // Only offer screens the org actually has — a template can't grant a screen
  // that belongs to a module the org hasn't installed (modular gating).
  const available = availableScreens(ctx.modules);
  const screens = [...GATEABLE_SCREENS].filter((s) => available.has(s));

  return (
    <div className="flex flex-col gap-6">
      <AccessTemplatesManager templates={templates} screens={screens} />
    </div>
  );
}
