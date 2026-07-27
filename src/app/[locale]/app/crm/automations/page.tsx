import { getTranslations } from "next-intl/server";
import { ArrowLeft, Workflow } from "lucide-react";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { listAutomationRules } from "@/lib/queries/automations";
import { listPipelinesWithStages } from "@/lib/queries/pipelines";
import { listQuickReplies } from "@/lib/queries/quick-replies";
import { AutomationsClient } from "@/components/crm/automations-client";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function AutomationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.automations");

  const [rules, pipelines, templates] = await Promise.all([
    listAutomationRules(ctx.organizationId),
    listPipelinesWithStages(ctx.organizationId),
    listQuickReplies(ctx.organizationId),
  ]);

  const stages = pipelines.flatMap((p) => p.stages.map((s) => ({ id: s.id, name: s.name, pipeline: p.name })));
  const canEdit = hasRole(ctx.role, "ADMIN");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <Link href="/app/crm" className="text-muted-foreground transition-colors hover:text-foreground" aria-label={t("back")}>
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Workflow className="size-6 text-brand" />
            {t("title")}
          </h1>
        </div>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <AutomationsClient
        rules={rules}
        stages={stages}
        templates={templates.map((x) => ({ id: x.id, name: x.name }))}
        canEdit={canEdit}
      />

      {!canEdit ? <p className="text-xs text-muted-foreground">{t("readOnly")}</p> : null}
    </div>
  );
}
