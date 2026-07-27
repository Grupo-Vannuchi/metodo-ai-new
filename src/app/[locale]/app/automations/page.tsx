import { getTranslations } from "next-intl/server";
import { Workflow } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { requireScreen } from "@/lib/access";
import { listAutomationRules } from "@/lib/queries/automations";
import { listPipelinesWithStages } from "@/lib/queries/pipelines";
import { listQuickReplies } from "@/lib/queries/quick-replies";
import { listTeamMembers } from "@/lib/queries/team-chat";
import { AutomationsClient } from "@/components/crm/automations-client";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** Top-level Automations — acts on the CRM funnel, so gated by the "crm" screen. */
export default async function AutomationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  await requireScreen(ctx, "crm", locale);
  const t = await getTranslations("crm.automations");

  const [rules, pipelines, templates, members] = await Promise.all([
    listAutomationRules(ctx.organizationId),
    listPipelinesWithStages(ctx.organizationId),
    listQuickReplies(ctx.organizationId),
    listTeamMembers(ctx.organizationId),
  ]);

  const stages = pipelines.flatMap((p) => p.stages.map((s) => ({ id: s.id, name: s.name, pipeline: p.name })));
  const canEdit = hasRole(ctx.role, "ADMIN");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Workflow className="size-6 text-brand" />
          {t("title")}
        </h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <AutomationsClient
        rules={rules}
        stages={stages}
        templates={templates.map((x) => ({ id: x.id, name: x.name }))}
        members={members.map((m) => ({ id: m.userId, name: m.name }))}
        canEdit={canEdit}
      />

      {!canEdit ? <p className="text-xs text-muted-foreground">{t("readOnly")}</p> : null}
    </div>
  );
}
