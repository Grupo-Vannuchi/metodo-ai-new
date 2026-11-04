import { notFound } from "next/navigation";
import { hasModule } from "@/config/modules";
import { requireOrgContext, hasRole } from "@/lib/tenant";
import { getGroupAddRunView } from "@/lib/queries/whatsapp-group-add";
import { GROUP_UNREADABLE } from "@/lib/whatsapp/group-add/runner";
import { forecastGroupAddRun } from "@/lib/whatsapp/group-add/service";
import { GroupAddRun } from "@/components/crm/group-add-run";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/**
 * Tracking of a round of "Adicionar a grupo do WhatsApp". The contacts layout already gates the screen `contacts` and the
 * module `crm`; the round also needs `inbox` (the number is the one of Conversas). A round of another company is as good as
 * none: `notFound()`, never "forbidden". Everything the screen decides from the clock (is it waiting, when does it end) is
 * decided here and sent ready, and so is who may steer it.
 */
export default async function GroupAddRunPage({
  params,
}: {
  params: Promise<{ locale: string; runId: string }>;
}) {
  const { locale: rawLocale, runId } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  if (!hasModule(ctx.modules, "inbox")) notFound();

  const run = await getGroupAddRunView(ctx.organizationId, runId);
  if (!run) notFound();

  const now = new Date();
  const forecastAt = run.status === "RUNNING" ? await forecastGroupAddRun(ctx.organizationId, run.id) : null;
  // The wait is only told while it lasts: a stamp in the past is a person being tried right now, or a round no one has picked up yet.
  const waiting =
    run.status === "RUNNING" && run.waitReason !== null && run.nextAttemptAt !== null && run.nextAttemptAt.getTime() > now.getTime();

  return (
    <GroupAddRun
      runId={run.id}
      groupName={run.groupName}
      status={run.status}
      pausedReason={run.status === "PAUSED" ? run.pausedReason : null}
      unreadable={run.status === "PAUSED" && run.pausedReason === "not_admin" && run.lastError === GROUP_UNREADABLE}
      waitReason={waiting ? run.waitReason : null}
      counts={run.counts}
      items={run.items.map((i) => ({
        contactId: i.contactId,
        contactName: i.contactName,
        status: i.status,
        reason: i.reason,
        processedAt: i.processedAt?.toISOString() ?? null,
      }))}
      startedAt={run.startedAt?.toISOString() ?? null}
      finishedAt={run.finishedAt?.toISOString() ?? null}
      forecastAt={forecastAt?.toISOString() ?? null}
      now={now.toISOString()}
      canSteer={run.createdById === ctx.userId || hasRole(ctx.role, "ADMIN")}
    />
  );
}
