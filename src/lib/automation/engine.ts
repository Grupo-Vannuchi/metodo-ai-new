import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { parseActions, parseConfig, type RuleAction } from "@/lib/automation/types";

/**
 * The automation engine: given a CRM event, run every enabled rule that matches.
 *
 * Rules run right after the triggering action commits, but this NEVER throws
 * into that caller — a broken rule must not stop a card from moving or a deal
 * from being won. Each action is also isolated, so one failure doesn't skip the
 * rest. WhatsApp sends are best-effort (fire and log).
 */

export type AutomationEvent =
  | { type: "opportunity_created"; opportunityId: string }
  | { type: "stage_entered"; opportunityId: string; stageId: string }
  | { type: "opportunity_won"; opportunityId: string }
  | { type: "opportunity_lost"; opportunityId: string }
  | { type: "task_completed"; opportunityId: string };

type Db = ReturnType<typeof tenantDb>;
type Opp = {
  id: string;
  title: string;
  value: unknown;
  ownerId: string | null;
  contactId: string | null;
  contact: { name: string; phone: string | null } | null;
};

export async function runAutomations(
  organizationId: string,
  event: AutomationEvent,
  actorName: string,
): Promise<void> {
  try {
    const db = tenantDb(organizationId);
    const rules = await db.automationRule.findMany({
      where: {
        enabled: true,
        trigger: event.type,
        ...(event.type === "stage_entered" ? { triggerStageId: event.stageId } : {}),
      },
      select: { id: true, actions: true, config: true },
    });
    if (rules.length === 0) return;

    const opp = (await db.opportunity.findFirst({
      where: { id: event.opportunityId },
      select: {
        id: true,
        title: true,
        value: true,
        ownerId: true,
        contactId: true,
        contact: { select: { name: true, phone: true } },
      },
    })) as Opp | null;
    if (!opp) return;
    const oppValue = Number(opp.value ?? 0);

    for (const rule of rules) {
      // Condition: only fire above a minimum deal value.
      const cfg = parseConfig(rule.config);
      if (cfg.minValue !== undefined && oppValue < cfg.minValue) continue;

      for (const action of parseActions(rule.actions)) {
        try {
          await runAction(db, organizationId, opp, action, actorName);
        } catch (e) {
          console.error("[automation] action failed", rule.id, action.type, e);
        }
      }
    }
  } catch (e) {
    console.error("[automation] runAutomations failed", e);
  }
}

async function runAction(
  db: Db,
  organizationId: string,
  opp: Opp,
  action: RuleAction,
  actorName: string,
): Promise<void> {
  if (action.type === "create_task") {
    const dueDate =
      action.dueInDays !== undefined ? new Date(Date.now() + action.dueInDays * 86_400_000) : null;
    await db.task.create({
      data: {
        organizationId,
        title: action.title || "Tarefa",
        description: action.description || null,
        priority: (action.priority ?? "MEDIUM") as never,
        dueDate,
        opportunityId: opp.id,
        contactId: opp.contactId,
        assignedToId: opp.ownerId,
      },
    });
    return;
  }

  if (action.type === "notify_owner") {
    if (!opp.ownerId) return;
    await db.notification.create({
      data: {
        organizationId,
        userId: opp.ownerId,
        type: "AUTOMATION",
        data: { title: opp.title, actor: actorName, message: action.message ?? null },
        link: `/app/crm/${opp.id}`,
      },
    });
    return;
  }

  if (action.type === "move_stage") {
    const stage = await db.stage.findFirst({ where: { id: action.stageId }, select: { id: true, pipelineId: true } });
    if (!stage) return;
    const order = await db.opportunity.count({ where: { stageId: stage.id } });
    await db.opportunity.updateMany({ where: { id: opp.id }, data: { stageId: stage.id, pipelineId: stage.pipelineId, order } });
    return;
  }

  if (action.type === "set_owner") {
    const member = await db.$queryRaw<{ userId: string }[]>`
      SELECT "userId" FROM memberships WHERE "organizationId" = ${organizationId} AND "userId" = ${action.userId} LIMIT 1`;
    if (!member[0]) return;
    await db.opportunity.updateMany({ where: { id: opp.id }, data: { ownerId: action.userId } });
    if (action.userId !== opp.ownerId) {
      await db.notification.create({
        data: {
          organizationId,
          userId: action.userId,
          type: "OPP_ASSIGNED",
          data: { actor: actorName, title: opp.title },
          link: `/app/crm/${opp.id}`,
        },
      });
    }
    return;
  }

  if (action.type === "send_whatsapp") {
    const phone = opp.contact?.phone;
    if (!phone || !action.templateId) return;
    const tpl = await db.messageTemplate.findFirst({
      where: { id: action.templateId },
      select: { body: true },
    });
    if (!tpl) return;

    const name = opp.contact?.name ?? "";
    const first = name.trim().split(/\s+/)[0] ?? "";
    const body = tpl.body
      .replace(/\{\s*(nome|name)\s*\}/gi, name)
      .replace(/\{\s*(primeiro[_ ]?nome|first[_ ]?name)\s*\}/gi, first);

    // Send from an active WhatsApp connection — the owner's if they have one,
    // else any active org connection.
    const conn =
      (opp.ownerId
        ? await db.integrationConnection.findFirst({
            where: { provider: "EVOLUTION", status: "ACTIVE", ownerId: opp.ownerId },
            select: { id: true },
          })
        : null) ??
      (await db.integrationConnection.findFirst({
        where: { provider: "EVOLUTION", status: "ACTIVE" },
        select: { id: true },
      }));
    if (!conn) return;

    const creds = await loadEvoCredsById(conn.id);
    if (!creds) return;
    await getChannelAdapter("WHATSAPP_EVOLUTION").send(creds, { to: phone, body });
  }
}
