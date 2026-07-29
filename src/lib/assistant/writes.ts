import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import type { OrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { canAccessScreen } from "@/lib/access";
import { hasFeature, type PlanKey } from "@/config/plans";
import { formatBRL } from "@/lib/money";
import { audit } from "@/lib/audit";
import { moveOpportunity } from "@/app/actions/opportunities";

const DAY = 86_400_000;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
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

const WRITE_TOOL_NAMES = new Set([
  "create_task",
  "move_opportunity",
  "set_expected_close",
  "create_finance_entry",
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}

/** Write tools available to this org (finance is plan/access gated). */
export function writeToolsFor(ctx: OrgContext): Anthropic.Tool[] {
  const financeOk =
    hasFeature(ctx.organization.plan as PlanKey, "finance") && canAccessScreen(ctx, "finance");
  return financeOk ? [...BASE_WRITE_TOOLS, FINANCE_WRITE_TOOL] : BASE_WRITE_TOOLS;
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
    case "create_finance_entry":
      return `Criar lançamento: "${str(args.description)}" — ${str(args.type) === "EXPENSE" ? "despesa" : "receita"} de ${formatBRL(num(args.amount) ?? 0)}`;
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

    return { ok: false, message: "Ação desconhecida." };
  } catch (e) {
    console.error(`[assistant] executeWrite ${tool} failed`, e);
    return { ok: false, message: "Não consegui concluir a ação." };
  }
}
