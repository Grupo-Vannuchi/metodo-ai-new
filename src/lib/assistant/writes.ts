import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import type { OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { canAccessScreen } from "@/lib/access";
import { hasFeature, type PlanKey } from "@/config/plans";
import { formatBRL } from "@/lib/money";
import { audit } from "@/lib/audit";
import { moveOpportunity, setOpportunityStatus } from "@/app/actions/opportunities";
import { sendMessage, startConversation } from "@/app/actions/inbox";
import { sendEmail } from "@/lib/email/send";
import { createRule } from "@/app/actions/automations";
import { ACTION_TYPES, TRIGGERS } from "@/lib/automation/types";
import { sendTeamMessage } from "@/app/actions/team-chat";

const DAY = 86_400_000;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Actions the copilot can propose. Every one is executed only AFTER the user
 * confirms on screen (see /api/assistant/execute); the model never writes
 * directly. `create_finance_entry` is added conditionally (plan + access). */
const BASE_WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_task",
    description:
      "Cria uma tarefa (após confirmação do usuário). Atribuída ao próprio usuário. Pode vincular a uma oportunidade/contato pelo id.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título da tarefa." },
        description: { type: "string", description: "Descrição/observações." },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"], description: "Prioridade. Padrão MEDIUM." },
        dueInDays: { type: "number", description: "Prazo em dias a partir de hoje." },
        opportunityId: { type: "string", description: "Id da oportunidade a vincular (opcional)." },
        contactId: { type: "string", description: "Id do contato a vincular (opcional)." },
      },
      required: ["title"],
    },
  },
  {
    name: "move_opportunity",
    description: "Move uma oportunidade para outra etapa do funil (após confirmação).",
    input_schema: {
      type: "object",
      properties: {
        opportunityId: { type: "string", description: "Id da oportunidade." },
        toStageId: { type: "string", description: "Id da etapa de destino (obtenha via get_opportunity/get_pipeline_summary)." },
      },
      required: ["opportunityId", "toStageId"],
    },
  },
  {
    name: "set_expected_close",
    description: "Define a previsão de fechamento de uma oportunidade, em N dias a partir de hoje (após confirmação).",
    input_schema: {
      type: "object",
      properties: {
        opportunityId: { type: "string", description: "Id da oportunidade." },
        inDays: { type: "number", description: "Dias a partir de hoje." },
      },
      required: ["opportunityId", "inDays"],
    },
  },
  {
    name: "set_opportunity_status",
    description:
      "Muda o status de uma oportunidade (após confirmação): OPEN (aberta), ON_HOLD (em espera), WON (ganha), LOST (perdida), CANCELED (cancelada). Para LOST/CANCELED, informe o motivo.",
    input_schema: {
      type: "object",
      properties: {
        opportunityId: { type: "string", description: "Id da oportunidade." },
        status: { type: "string", enum: ["OPEN", "ON_HOLD", "WON", "LOST", "CANCELED"], description: "Novo status." },
        outcomeReason: { type: "string", description: "Motivo (obrigatório para LOST/CANCELED)." },
      },
      required: ["opportunityId", "status"],
    },
  },
  {
    name: "set_owner",
    description: "Define o responsável (owner) de uma oportunidade (após confirmação).",
    input_schema: {
      type: "object",
      properties: {
        opportunityId: { type: "string", description: "Id da oportunidade." },
        userId: { type: "string", description: "Id do responsável (membro da organização)." },
      },
      required: ["opportunityId", "userId"],
    },
  },
  {
    name: "add_tag",
    description: "Adiciona uma tag a um contato (após confirmação).",
    input_schema: {
      type: "object",
      properties: {
        contactId: { type: "string", description: "Id do contato." },
        tag: { type: "string", description: "Tag a adicionar." },
      },
      required: ["contactId", "tag"],
    },
  },
  {
    name: "send_team_chat",
    description:
      "Envia uma mensagem numa conversa de equipe (chat interno), após confirmação. Use o id obtido em list_team_chats. Ideal para responder ou encaminhar um resumo à equipe.",
    input_schema: {
      type: "object",
      properties: {
        chatId: { type: "string", description: "Id da conversa de equipe." },
        message: { type: "string", description: "Texto da mensagem." },
      },
      required: ["chatId", "message"],
    },
  },
];

const FINANCE_WRITE_TOOL: Anthropic.Tool = {
  name: "create_finance_entry",
  description: "Cria um lançamento financeiro (após confirmação). Receita (INCOME) ou despesa (EXPENSE).",
  input_schema: {
    type: "object",
    properties: {
      description: { type: "string", description: "Descrição do lançamento." },
      amount: { type: "number", description: "Valor em reais (positivo)." },
      type: { type: "string", enum: ["INCOME", "EXPENSE"], description: "Tipo. Padrão INCOME." },
      dueInDays: { type: "number", description: "Vencimento em dias a partir de hoje. Padrão 0 (hoje)." },
      opportunityId: { type: "string", description: "Id da oportunidade a vincular (opcional)." },
    },
    required: ["description", "amount"],
  },
};

const WHATSAPP_WRITE_TOOL: Anthropic.Tool = {
  name: "send_whatsapp",
  description:
    "Envia uma mensagem de WhatsApp para um número (após confirmação). Use o telefone do contato/oportunidade (search_crm e get_opportunity retornam o telefone). Só funciona se o usuário tiver uma conexão de WhatsApp ativa.",
  input_schema: {
    type: "object",
    properties: {
      phone: { type: "string", description: "Telefone do destinatário, com DDD." },
      name: { type: "string", description: "Nome do destinatário (opcional)." },
      contactId: { type: "string", description: "Id do contato, se houver (opcional)." },
      message: { type: "string", description: "Texto da mensagem a enviar." },
    },
    required: ["phone", "message"],
  },
};

const EMAIL_WRITE_TOOL: Anthropic.Tool = {
  name: "send_email",
  description:
    "Envia um e-mail (após confirmação). Use o e-mail do contato (search_crm/get_opportunity).",
  input_schema: {
    type: "object",
    properties: {
      to: { type: "string", description: "E-mail do destinatário." },
      subject: { type: "string", description: "Assunto do e-mail." },
      body: { type: "string", description: "Corpo do e-mail em texto simples (quebras de linha viram parágrafos)." },
    },
    required: ["to", "subject", "body"],
  },
};

const AUTOMATION_WRITE_TOOL: Anthropic.Tool = {
  name: "create_automation",
  description:
    "Cria uma automação (regra 'quando o gatilho ocorre → executa as ações') no funil, após confirmação. Campos por tipo de ação: create_task{title,description?,priority?,dueInDays?}; notify_owner{message?}; notify_user{userId,message?}; send_whatsapp{templateId}; send_email{subject,body}; move_stage{stageId}; set_owner{userId}; set_expected_close{inDays}; add_tag{tag}; create_finance_entry{description,useOppValue?,amount?,dueInDays?}; webhook{url}.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nome da automação." },
      trigger: { type: "string", enum: [...TRIGGERS], description: "Gatilho. stage_entered exige triggerStageId." },
      triggerStageId: { type: "string", description: "Id da etapa (apenas para stage_entered)." },
      actions: {
        type: "array",
        description: "Ações executadas quando o gatilho ocorre (na ordem).",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...ACTION_TYPES], description: "Tipo da ação." },
          },
          required: ["type"],
        },
      },
    },
    required: ["name", "trigger", "actions"],
  } as Anthropic.Tool.InputSchema,
};

const WRITE_TOOL_NAMES = new Set([
  "create_task",
  "move_opportunity",
  "set_expected_close",
  "set_opportunity_status",
  "set_owner",
  "add_tag",
  "create_finance_entry",
  "send_whatsapp",
  "send_email",
  "send_team_chat",
  "create_automation",
]);

export const PLAN_TOOL_NAME = "plan_actions";

export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}

/** Write tools available to this org (finance + messaging are access gated). */
export function writeToolsFor(ctx: OrgContext): Anthropic.Tool[] {
  const tools = [...BASE_WRITE_TOOLS];
  if (hasFeature(ctx.organization.plan as PlanKey, "finance") && canAccessScreen(ctx, "finance")) {
    tools.push(FINANCE_WRITE_TOOL);
  }
  if (canAccessScreen(ctx, "inbox")) tools.push(WHATSAPP_WRITE_TOOL);
  if (canAccessScreen(ctx, "inbox") || canAccessScreen(ctx, "campaigns")) tools.push(EMAIL_WRITE_TOOL);
  if (canAccessScreen(ctx, "crm")) tools.push(AUTOMATION_WRITE_TOOL);
  return tools;
}

/**
 * A meta-tool that bundles several write steps into one plan the user approves
 * at once (a multi-step process). The `tool` of each step is constrained to the
 * write tools this org actually has.
 */
export function buildPlanTool(ctx: OrgContext): Anthropic.Tool {
  const names = writeToolsFor(ctx).map((t) => t.name);
  return {
    name: PLAN_TOOL_NAME,
    description:
      "Agrupa VÁRIAS ações em um único plano para o usuário aprovar de uma vez (ex.: marcar como ganha + criar tarefa + enviar WhatsApp). Use quando o pedido envolver um processo com múltiplos passos, em vez de pedir várias confirmações separadas.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título curto do processo." },
        steps: {
          type: "array",
          description: "Passos, em ordem de execução.",
          items: {
            type: "object",
            properties: {
              tool: { type: "string", enum: names, description: "Ação de escrita deste passo." },
              summary: { type: "string", description: "Resumo em português do que o passo faz." },
              args: { type: "object", description: "Argumentos da ação, conforme a ferramenta escolhida." },
            },
            required: ["tool", "summary", "args"],
          },
        },
      },
      required: ["title", "steps"],
    } as Anthropic.Tool.InputSchema,
  };
}

/** A short, human summary for the confirmation card (no DB reads). */
export function summarizeWrite(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "create_task": {
      const d = num(args.dueInDays);
      return `Criar tarefa: "${str(args.title)}"${d != null ? ` — vence em ${d} dia(s)` : ""}`;
    }
    case "move_opportunity":
      return "Mover a oportunidade para outra etapa do funil";
    case "set_expected_close":
      return `Definir previsão de fechamento para daqui a ${num(args.inDays) ?? "?"} dia(s)`;
    case "set_opportunity_status":
      return `Marcar oportunidade como ${str(args.status)}${str(args.outcomeReason) ? ` (motivo: ${str(args.outcomeReason)})` : ""}`;
    case "set_owner":
      return "Definir o responsável da oportunidade";
    case "add_tag":
      return `Adicionar a tag "${str(args.tag)}" ao contato`;
    case "send_team_chat":
      return `Enviar no chat de equipe:\n\n"${str(args.message)}"`;
    case "create_finance_entry":
      return `Criar lançamento: "${str(args.description)}" — ${str(args.type) === "EXPENSE" ? "despesa" : "receita"} de ${formatBRL(num(args.amount) ?? 0)}`;
    case "send_whatsapp":
      return `Enviar WhatsApp para ${str(args.name) || str(args.phone)}:\n\n"${str(args.message)}"`;
    case "send_email":
      return `Enviar e-mail para ${str(args.to)} — assunto "${str(args.subject)}":\n\n"${str(args.body)}"`;
    case "create_automation": {
      const n = Array.isArray(args.actions) ? args.actions.length : 0;
      return `Criar automação "${str(args.name)}" — quando ${str(args.trigger)} → ${n} ação(ões)`;
    }
    default:
      return "Executar ação";
  }
}

export type WriteResult = { ok: boolean; message: string };

/** Execute a confirmed write under the caller's org context. Audited. */
export async function executeWrite(
  ctx: OrgContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<WriteResult> {
  const db = tenantDb(ctx.organizationId);
  try {
    if (tool === "create_task") {
      const title = str(args.title);
      if (!title) return { ok: false, message: "Título da tarefa é obrigatório." };
      const oppId = str(args.opportunityId) || null;
      const contactId = str(args.contactId) || null;
      if (oppId && !(await db.opportunity.findFirst({ where: { id: oppId }, select: { id: true } })))
        return { ok: false, message: "Oportunidade não encontrada." };
      if (contactId && !(await db.contact.findFirst({ where: { id: contactId }, select: { id: true } })))
        return { ok: false, message: "Contato não encontrado." };
      const dueInDays = num(args.dueInDays);
      const priority = ["LOW", "MEDIUM", "HIGH"].includes(str(args.priority)) ? str(args.priority) : "MEDIUM";
      const task = await db.task.create({
        data: {
          organizationId: ctx.organizationId,
          title,
          description: str(args.description) || null,
          priority: priority as never,
          dueDate: dueInDays != null ? new Date(Date.now() + dueInDays * DAY) : null,
          assignedToId: ctx.userId,
          opportunityId: oppId,
          contactId,
        },
      });
      await audit(ctx, { action: "assistant.task_created", entity: "Task", entityId: task.id, meta: { title } });
      revalidatePath("/app/tasks");
      return { ok: true, message: `Tarefa "${title}" criada.` };
    }

    if (tool === "move_opportunity") {
      const opportunityId = str(args.opportunityId);
      const toStageId = str(args.toStageId);
      if (!opportunityId || !toStageId) return { ok: false, message: "Oportunidade e etapa são obrigatórias." };
      const res = await moveOpportunity({ opportunityId, toStageId });
      if (!res.ok) return { ok: false, message: "Não consegui mover a oportunidade." };
      await audit(ctx, { action: "assistant.opportunity_moved", entity: "Opportunity", entityId: opportunityId });
      return { ok: true, message: "Oportunidade movida." };
    }

    if (tool === "set_expected_close") {
      const opportunityId = str(args.opportunityId);
      const inDays = num(args.inDays);
      if (!opportunityId || inDays == null) return { ok: false, message: "Oportunidade e prazo (em dias) são obrigatórios." };
      const upd = await db.opportunity.updateMany({
        where: { id: opportunityId },
        data: { expectedCloseDate: new Date(Date.now() + inDays * DAY) },
      });
      if (upd.count === 0) return { ok: false, message: "Oportunidade não encontrada." };
      await audit(ctx, { action: "assistant.opportunity_updated", entity: "Opportunity", entityId: opportunityId });
      revalidatePath(`/app/crm/${opportunityId}`);
      revalidatePath("/app/crm");
      return { ok: true, message: `Previsão de fechamento definida para daqui a ${inDays} dia(s).` };
    }

    if (tool === "set_opportunity_status") {
      const id = str(args.opportunityId);
      const status = str(args.status);
      if (!id || !["OPEN", "ON_HOLD", "WON", "LOST", "CANCELED"].includes(status))
        return { ok: false, message: "Oportunidade e status válidos são obrigatórios." };
      const reason = str(args.outcomeReason) || undefined;
      if ((status === "LOST" || status === "CANCELED") && !reason)
        return { ok: false, message: "Informe o motivo para marcar como perdida/cancelada." };
      const res = await setOpportunityStatus(id, status as Parameters<typeof setOpportunityStatus>[1], reason);
      if (!res.ok) return { ok: false, message: "Não consegui atualizar o status da oportunidade." };
      await audit(ctx, { action: "assistant.opportunity_updated", entity: "Opportunity", entityId: id, meta: { status } });
      return { ok: true, message: `Oportunidade marcada como ${status}.` };
    }

    if (tool === "set_owner") {
      if (!canAccessScreen(ctx, "crm")) return { ok: false, message: "Você não tem acesso ao CRM." };
      const opportunityId = str(args.opportunityId);
      const userId = str(args.userId);
      if (!opportunityId || !userId) return { ok: false, message: "Oportunidade e responsável são obrigatórios." };
      const member = await prisma.membership.findFirst({
        where: { organizationId: ctx.organizationId, userId },
        select: { userId: true },
      });
      if (!member) return { ok: false, message: "Esse usuário não é membro da organização." };
      const opp = await db.opportunity.findFirst({
        where: { id: opportunityId },
        select: { id: true, title: true, ownerId: true },
      });
      if (!opp) return { ok: false, message: "Oportunidade não encontrada." };
      await db.opportunity.updateMany({ where: { id: opportunityId }, data: { ownerId: userId } });
      if (userId !== opp.ownerId) {
        await db.notification.create({
          data: {
            organizationId: ctx.organizationId,
            userId,
            type: "OPP_ASSIGNED",
            data: { actor: ctx.user.name, title: opp.title },
            link: `/app/crm/${opportunityId}`,
          },
        });
      }
      await audit(ctx, { action: "assistant.opportunity_updated", entity: "Opportunity", entityId: opportunityId, meta: { ownerId: userId } });
      revalidatePath(`/app/crm/${opportunityId}`);
      revalidatePath("/app/crm");
      return { ok: true, message: "Responsável atualizado." };
    }

    if (tool === "add_tag") {
      if (!canAccessScreen(ctx, "contacts")) return { ok: false, message: "Você não tem acesso aos contatos." };
      const contactId = str(args.contactId);
      const tag = str(args.tag);
      if (!contactId || !tag) return { ok: false, message: "Contato e tag são obrigatórios." };
      const c = await db.contact.findFirst({ where: { id: contactId }, select: { tags: true } });
      if (!c) return { ok: false, message: "Contato não encontrado." };
      if (c.tags.includes(tag)) return { ok: true, message: `O contato já tem a tag "${tag}".` };
      await db.contact.updateMany({ where: { id: contactId }, data: { tags: [...c.tags, tag] } });
      await audit(ctx, { action: "assistant.contact_tagged", entity: "contacts", entityId: contactId, meta: { tag } });
      revalidatePath("/app/contacts");
      revalidatePath(`/app/contacts/${contactId}`);
      return { ok: true, message: `Tag "${tag}" adicionada ao contato.` };
    }

    if (tool === "create_finance_entry") {
      if (!hasFeature(ctx.organization.plan as PlanKey, "finance") || !canAccessScreen(ctx, "finance"))
        return { ok: false, message: "O Financeiro não está disponível no seu plano/acesso." };
      const description = str(args.description);
      const amount = num(args.amount);
      if (!description || amount == null || !(amount > 0))
        return { ok: false, message: "Descrição e valor (maior que zero) são obrigatórios." };
      const type = str(args.type) === "EXPENSE" ? "EXPENSE" : "INCOME";
      const dueInDays = num(args.dueInDays) ?? 0;
      const oppId = str(args.opportunityId) || null;
      if (oppId && !(await db.opportunity.findFirst({ where: { id: oppId }, select: { id: true } })))
        return { ok: false, message: "Oportunidade não encontrada." };
      const entry = await db.financeEntry.create({
        data: {
          organizationId: ctx.organizationId,
          type: type as never,
          description,
          amount,
          dueDate: new Date(Date.now() + dueInDays * DAY),
          opportunityId: oppId,
        },
      });
      await audit(ctx, { action: "assistant.finance_created", entity: "FinanceEntry", entityId: entry.id, meta: { amount } });
      revalidatePath("/app/finance");
      revalidatePath("/app/finance/entries");
      return { ok: true, message: `Lançamento "${description}" (${formatBRL(amount)}) criado.` };
    }

    if (tool === "send_whatsapp") {
      if (!canAccessScreen(ctx, "inbox")) return { ok: false, message: "Você não tem acesso ao Inbox." };
      const phone = str(args.phone);
      const message = str(args.message);
      if (!phone || !message) return { ok: false, message: "Telefone e mensagem são obrigatórios." };
      const conv = await startConversation({
        phone,
        name: str(args.name) || undefined,
        contactId: str(args.contactId) || undefined,
      });
      if (!conv.ok) {
        return {
          ok: false,
          message:
            conv.error === "no_connection"
              ? "Você não tem uma conexão de WhatsApp ativa."
              : "Não consegui abrir a conversa.",
        };
      }
      const sent = await sendMessage(conv.conversationId, message);
      if (!sent.ok) return { ok: false, message: "Não consegui enviar o WhatsApp." };
      await audit(ctx, {
        action: "assistant.whatsapp_sent",
        entity: "contacts",
        entityId: str(args.contactId) || undefined,
        meta: { phone },
      });
      return { ok: true, message: `WhatsApp enviado para ${str(args.name) || phone}.` };
    }

    if (tool === "send_email") {
      if (!canAccessScreen(ctx, "inbox") && !canAccessScreen(ctx, "campaigns"))
        return { ok: false, message: "Você não tem acesso para enviar e-mails." };
      const to = str(args.to);
      const subject = str(args.subject);
      const body = str(args.body);
      if (!to || !subject || !body)
        return { ok: false, message: "Destinatário, assunto e corpo são obrigatórios." };
      const html = body
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
      const res = await sendEmail({ to, subject, html, text: body });
      if (!res.ok) {
        return {
          ok: false,
          message:
            res.error === "not_configured"
              ? "O envio de e-mail ainda não está configurado."
              : "Não consegui enviar o e-mail.",
        };
      }
      await audit(ctx, { action: "assistant.email_sent", entity: "contacts", meta: { to, subject } });
      return { ok: true, message: `E-mail enviado para ${to}.` };
    }

    if (tool === "send_team_chat") {
      const chatId = str(args.chatId);
      const message = str(args.message);
      if (!chatId || !message) return { ok: false, message: "Conversa e mensagem são obrigatórias." };
      const res = await sendTeamMessage({ chatId, body: message });
      if (!res.ok)
        return {
          ok: false,
          message: res.error === "forbidden" ? "Você não participa dessa conversa." : "Não consegui enviar a mensagem.",
        };
      await audit(ctx, { action: "assistant.team_message_sent", entity: "TeamChat", entityId: chatId });
      return { ok: true, message: "Mensagem enviada no chat de equipe." };
    }

    if (tool === "create_automation") {
      if (!canAccessScreen(ctx, "crm")) return { ok: false, message: "Você não tem acesso às automações." };
      const name = str(args.name);
      const trigger = str(args.trigger);
      const actions = Array.isArray(args.actions) ? args.actions : [];
      if (!name || !trigger || actions.length === 0)
        return { ok: false, message: "Nome, gatilho e ao menos uma ação são obrigatórios." };
      const res = await createRule({
        name,
        trigger,
        triggerStageId: str(args.triggerStageId) || undefined,
        actions,
        config: args.config,
      });
      if (!res.ok)
        return {
          ok: false,
          message: res.error === "invalid" ? "Automação inválida — verifique o gatilho e as ações." : "Não consegui criar a automação.",
        };
      await audit(ctx, { action: "assistant.automation_created", entity: "AutomationRule", entityId: res.id, meta: { name } });
      return { ok: true, message: `Automação "${name}" criada.` };
    }

    return { ok: false, message: "Ação desconhecida." };
  } catch (e) {
    console.error(`[assistant] executeWrite ${tool} failed`, e);
    return { ok: false, message: "Não consegui concluir a ação." };
  }
}

/** Run a confirmed multi-step plan in order, reporting each step's outcome. */
export async function executePlan(
  ctx: OrgContext,
  steps: { tool: string; args: Record<string, unknown> }[],
): Promise<WriteResult> {
  const lines: string[] = [];
  let allOk = true;
  for (const step of steps) {
    if (!isWriteTool(step.tool)) {
      lines.push(`✗ Ação inválida: ${step.tool}`);
      allOk = false;
      continue;
    }
    const r = await executeWrite(ctx, step.tool, step.args || {});
    lines.push(`${r.ok ? "✓" : "✗"} ${r.message}`);
    if (!r.ok) allOk = false;
  }
  return { ok: allOk, message: lines.join("\n") || "Nada a fazer." };
}
