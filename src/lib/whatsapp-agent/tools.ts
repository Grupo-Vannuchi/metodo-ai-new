import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/tenant-db";
import { hasFeature, type PlanKey } from "@/config/plans";
import { formatBRL } from "@/lib/money";
import { listSupplyItems } from "@/lib/queries/supply-items";

/**
 * Everything a bot tool needs. Unlike the copilot's OrgContext, the WhatsApp
 * agent has NO logged-in user: it's the org's bot, acting for one conversation.
 * `ownerId` is the human who set the agent up — writes are attributed to them,
 * and a handoff assigns the chat to them.
 */
export type BotContext = {
  organizationId: string;
  connectionId: string;
  conversationId: string;
  contactId: string | null;
  ownerId: string | null;
  plan: PlanKey;
};

/**
 * Tools the customer-facing agent may call autonomously (no human confirmation,
 * so the set is deliberately small and low-risk: it enriches/creates internal
 * CRM records and can pull in a human — it never sends anything on its own,
 * spends money, or mutates finance). `search_catalog` only appears when the org
 * has the Suprimentos module.
 */
export function agentToolset(plan: PlanKey): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [SAVE_LEAD, CREATE_OPPORTUNITY, HANDOFF];
  if (hasFeature(plan, "supplies")) tools.unshift(SEARCH_CATALOG);
  return tools;
}

const SEARCH_CATALOG: Anthropic.Tool = {
  name: "search_catalog",
  description:
    "Busca no catálogo de produtos/itens da empresa por um termo (nome, código, marca). Use para responder ao cliente preço, unidade e disponibilidade de um produto ANTES de afirmar qualquer valor. Nunca invente preços.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Termo do produto que o cliente quer." } },
    required: ["query"],
  },
};

const SAVE_LEAD: Anthropic.Tool = {
  name: "save_lead",
  description:
    "Salva/atualiza os dados do cliente desta conversa no CRM (nome, e-mail) e adiciona etiquetas de interesse para segmentação. Use quando o cliente informar o nome, e-mail ou demonstrar interesse claro em algo. Não peça dados só para preencher — registre o que ele já disse.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nome do cliente, se informado." },
      email: { type: "string", description: "E-mail do cliente, se informado." },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Etiquetas curtas de interesse (ex.: 'orçamento', 'produto X'). Máx. 5.",
      },
    },
  },
};

const CREATE_OPPORTUNITY: Anthropic.Tool = {
  name: "create_opportunity",
  description:
    "Cria uma oportunidade no funil de vendas ligada a este cliente, na primeira etapa. Use quando houver INTENÇÃO DE COMPRA clara (o cliente quer orçamento, contratar ou comprar). Não crie para dúvidas genéricas.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título curto do que o cliente quer (ex.: 'Orçamento 10 cadeiras')." },
      value: { type: "number", description: "Valor estimado em reais, se der para inferir. Opcional." },
      notes: { type: "string", description: "Resumo do pedido/contexto do cliente. Opcional." },
    },
    required: ["title"],
  },
};

const HANDOFF: Anthropic.Tool = {
  name: "handoff_to_human",
  description:
    "Transfere a conversa para um atendente humano: silencia o bot neste chat e abre uma tarefa de atendimento. Use quando o cliente pedir para falar com uma pessoa, reclamar, ou o assunto fugir do que você pode resolver. Depois de chamar, dê UMA resposta curta avisando que um atendente vai continuar.",
  input_schema: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Motivo/resumo para o atendente saber o contexto." },
    },
  },
};

/** Execute a bot tool for one conversation. Never throws (returns an error
 *  string the model can relay). All writes are org-scoped + attributed to the
 *  agent's owner. */
export async function runAgentTool(
  ctx: BotContext,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    if (name === "search_catalog") return await searchCatalog(ctx, input);
    if (name === "save_lead") return await saveLead(ctx, input);
    if (name === "create_opportunity") return await createOpportunityTool(ctx, input);
    if (name === "handoff_to_human") return await handoff(ctx, input);
    return `Ferramenta desconhecida: ${name}`;
  } catch (e) {
    console.error(`[whatsapp-agent] tool ${name} failed`, e);
    return "A ferramenta falhou. Siga a conversa sem depender dela.";
  }
}

async function searchCatalog(ctx: BotContext, input: Record<string, unknown>): Promise<string> {
  if (!hasFeature(ctx.plan, "supplies")) return "Catálogo indisponível.";
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length < 2) return "Termo de busca muito curto.";
  const items = await listSupplyItems(ctx.organizationId, query);
  const active = items.filter((i) => i.active);
  if (active.length === 0) return "Nenhum produto encontrado com esse termo.";
  return JSON.stringify(
    active.slice(0, 8).map((i) => ({
      produto: i.description,
      codigo: i.code,
      unidade: i.unit,
      preco: i.salePrice == null ? null : formatBRL(i.salePrice),
    })),
  );
}

async function saveLead(ctx: BotContext, input: Record<string, unknown>): Promise<string> {
  if (!ctx.contactId) return "Não há contato vinculado a esta conversa.";
  const db = tenantDb(ctx.organizationId);
  const current = await db.contact.findFirst({
    where: { id: ctx.contactId },
    select: { id: true, name: true, email: true, tags: true },
  });
  if (!current) return "Contato não encontrado.";

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  const newTags = rawTags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 5);
  const tags = [...new Set([...current.tags, "lead-whatsapp", ...newTags])];

  await db.contact.updateMany({
    where: { id: ctx.contactId },
    data: {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      tags,
    },
  });
  return "Dados do cliente salvos no CRM.";
}

async function createOpportunityTool(ctx: BotContext, input: Record<string, unknown>): Promise<string> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return "Informe um título para a oportunidade.";
  if (!ctx.contactId) return "Não há contato vinculado a esta conversa.";
  const value = typeof input.value === "number" && isFinite(input.value) ? Math.max(0, input.value) : 0;
  const notes = typeof input.notes === "string" ? input.notes.trim() || null : null;

  const db = tenantDb(ctx.organizationId);
  // First stage of the default pipeline (fall back to any pipeline's first stage).
  const stage =
    (await db.stage.findFirst({
      where: { pipeline: { isDefault: true } },
      orderBy: { order: "asc" },
      select: { id: true, pipelineId: true },
    })) ??
    (await db.stage.findFirst({ orderBy: { order: "asc" }, select: { id: true, pipelineId: true } }));
  if (!stage) return "Não há funil configurado para criar a oportunidade.";

  const org = ctx.organizationId;
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  // Code generation must be atomic with the insert (per org/year sequence).
  const opp = await prisma.$transaction(async (tx) => {
    const order = await tx.opportunity.count({ where: { organizationId: org, stageId: stage.id } });
    const last = await tx.opportunity.findFirst({
      where: { organizationId: org, seqYear: year },
      orderBy: { seqNumber: "desc" },
      select: { seqNumber: true },
    });
    const seqNumber = (last?.seqNumber ?? 0) + 1;
    const code = `${String(seqNumber).padStart(4, "0")}/${yy}`;
    return tx.opportunity.create({
      data: {
        organizationId: org,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        title: title.slice(0, 140),
        value,
        contactId: ctx.contactId,
        ownerId: ctx.ownerId,
        createdById: ctx.ownerId,
        notes,
        order,
        seqYear: year,
        seqNumber,
        code,
      },
      select: { id: true, code: true },
    });
  });

  // Notify the owner that the bot opened a deal (best-effort).
  if (ctx.ownerId) {
    await db.notification
      .create({
        data: {
          organizationId: org,
          userId: ctx.ownerId,
          type: "OPP_ASSIGNED",
          data: { actor: "Agente WhatsApp", title: title.slice(0, 140) },
          link: `/app/crm/${opp.id}`,
        },
      })
      .catch(() => {});
  }
  return `Oportunidade ${opp.code} criada no funil.`;
}

async function handoff(ctx: BotContext, input: Record<string, unknown>): Promise<string> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const db = tenantDb(ctx.organizationId);

  // Assign the chat to the owner → Fase 3 (assignedToId) silences the bot now.
  if (ctx.ownerId) {
    await db.conversation.updateMany({
      where: { id: ctx.conversationId },
      data: { assignedToId: ctx.ownerId },
    });
    const task = await db.task.create({
      data: {
        organizationId: ctx.organizationId,
        title: "Atendimento humano solicitado no WhatsApp",
        description: reason || null,
        type: "FOLLOWUP",
        priority: "HIGH",
        status: "TODO",
        recurrence: "NONE",
        progress: 0,
        assignedToId: ctx.ownerId,
        createdById: ctx.ownerId,
        contactId: ctx.contactId,
      },
      select: { id: true },
    });
    await db.notification
      .create({
        data: {
          organizationId: ctx.organizationId,
          userId: ctx.ownerId,
          type: "TASK_ASSIGNED",
          data: { actor: "Agente WhatsApp", title: "Atendimento humano solicitado no WhatsApp" },
          link: `/app/tasks/${task.id}`,
        },
      })
      .catch(() => {});
    return "Conversa transferida para um atendente. O bot não responderá mais aqui.";
  }
  return "Transferência registrada. Um atendente dará sequência.";
}
