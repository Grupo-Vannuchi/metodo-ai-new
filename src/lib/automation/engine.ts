import "server-only";
import { tenantDb } from "@/lib/tenant-db";
import { getChannelAdapter } from "@/lib/integrations/channels";
import { loadEvoCredsById } from "@/lib/integrations/evolution-creds";
import { parseActions, type RuleAction } from "@/lib/automation/types";

/**
 * The automation engine: given a CRM event, run every enabled rule that matches.
 *
 * Rules run right after the triggering action commits, but this NEVER throws
 * into that caller — a broken rule must not stop a card from moving or a deal
 * from being won. Each action is also isolated, so one failure doesn't skip the
 * rest. WhatsApp sends are best-effort (fire and log).
 */

export type AutomationEvent =
  | { type: "stage_entered"; opportunityId: string; stageId: string }
  | { type: "opportunity_won"; opportunityId: string }
  | { type: "opportunity_lost"; opportunityId: string };

type Db = ReturnType<typeof tenantDb>;
type Opp = {
  id: string;
  title: string;
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
      select: { id: true, actions: true },
    });
    if (rules.length === 0) return;

    const opp = (await db.opportunity.findFirst({
      where: { id: event.opportunityId },
      select: {
        id: true,
        title: true,
        ownerId: true,
        contactId: true,
        contact: { select: { name: true, phone: true } },
      },
    })) as Opp | null;
    if (!opp) return;

    for (const rule of rules) {
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
    await db.task.create({
      data: {
        organizationId,
        title: action.title || "Tarefa",
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
        data: { title: opp.title, actor: actorName },
        link: `/app/crm/${opp.id}`,
      },
    });
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
