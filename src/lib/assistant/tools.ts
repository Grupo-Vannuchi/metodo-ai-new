import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { OrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasFeature, type PlanKey } from "@/config/plans";
import { formatBRL } from "@/lib/money";
import { globalSearch } from "@/lib/queries/search";
import { getSalesReport, type SalesPeriod } from "@/lib/queries/sales-report";
import { getOpportunity, stageOptions } from "@/lib/queries/crm";
import { listTasks, type TaskScope } from "@/lib/queries/tasks";
import { listQuickReplies } from "@/lib/queries/quick-replies";
import { getContact } from "@/lib/queries/contacts";
import { getCompany } from "@/lib/queries/companies";

/**
 * Read-only tool set (phases 0–1). Every tool executes under the caller's org
 * context (tenant-scoped) and respects the same screen access the UI enforces.
 * Write tools (create task, move opportunity, draft/send message…) arrive in
 * later phases behind explicit confirmation.
 */
export const assistantTools: Anthropic.Tool[] = [
  {
    name: "search_crm",
    description:
      "Busca no CRM por contatos, empresas, oportunidades, conversas do WhatsApp e lançamentos financeiros a partir de um termo. Retorna itens com tipo, título, subtítulo, detalhes e link (o link de oportunidade contém o id: /app/crm/<id>). Use para localizar registros reais antes de responder.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Termo de busca — nome, empresa, telefone, código da oportunidade, etc.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_pipeline_summary",
    description:
      "Resumo do funil de vendas no período: ganhos, perdidos, taxa de conversão, valor ganho, ticket médio, ciclo médio, principais motivos de perda e o funil aberto por etapa (quantidade e valor). Use para responder sobre desempenho e sobre onde estão os negócios.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["30D", "MONTH", "YEAR", "ALL"],
          description: "Período: 30D (últimos 30 dias), MONTH (mês atual), YEAR (ano), ALL (tudo). Padrão MONTH.",
        },
      },
    },
  },
  {
    name: "get_opportunity",
    description:
      "Detalhes de uma oportunidade específica pelo id (obtido do link retornado por search_crm, ex.: /app/crm/<id>, ou do contexto da tela quando o usuário está numa oportunidade). Retorna código, título, valor, etapa, status, empresa, contato, responsável, previsão de fechamento e notas.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da oportunidade." },
      },
      required: ["id"],
    },
  },
  {
    name: "list_my_tasks",
    description:
      "Lista as tarefas atribuídas ao próprio usuário, filtradas por situação. Use para responder 'o que preciso fazer', tarefas de hoje, atrasadas, etc.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["open", "today", "overdue", "upcoming", "done", "all"],
          description: "Filtro: open (abertas), today (hoje), overdue (atrasadas), upcoming (futuras), done (concluídas), all. Padrão open.",
        },
      },
    },
  },
  {
    name: "list_message_templates",
    description:
      "Lista os modelos de mensagem de WhatsApp da organização (nome + texto). Use como referência de tom e estilo ao RASCUNHAR uma mensagem, ou para responder quais modelos existem.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_pipeline_stages",
    description:
      "Lista as etapas do funil (id + nome), na ordem. Use para obter o id de uma etapa antes de mover uma oportunidade ou de criar automações por etapa (stage_entered / move_stage).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_contact",
    description:
      "Detalhes de um contato pelo id (obtido via search_crm): nome, e-mail, telefone, cargo, empresa, tags.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Id do contato." } },
      required: ["id"],
    },
  },
  {
    name: "get_company",
    description: "Detalhes de uma empresa pelo id (obtido via search_crm).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Id da empresa." } },
      required: ["id"],
    },
  },
];

function asPeriod(v: unknown): SalesPeriod {
  return v === "30D" || v === "YEAR" || v === "ALL" ? v : "MONTH";
}
function asTaskScope(v: unknown): TaskScope {
  return v === "today" || v === "overdue" || v === "upcoming" || v === "done" || v === "all"
    ? v
    : "open";
}

/** Execute a tool call under the caller's org context. Never throws. */
export async function runAssistantTool(
  ctx: OrgContext,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    if (name === "search_crm") {
      const query = typeof input.query === "string" ? input.query : "";
      if (query.trim().length < 2) return "Informe um termo de busca com pelo menos 2 caracteres.";
      const canFinance =
        hasFeature(ctx.organization.plan as PlanKey, "finance") && canAccessScreen(ctx, "finance");
      const results = await globalSearch(ctx.organizationId, query, {
        allowed: (screen) => canAccessScreen(ctx, screen),
        canFinance,
        viewer: { userId: ctx.userId, role: ctx.role },
      });
      if (results.length === 0) return "Nenhum resultado encontrado.";
      return JSON.stringify(
        results.slice(0, 8).map((r) => ({
          tipo: r.type,
          titulo: r.title,
          subtitulo: r.subtitle,
          detalhes: r.meta,
          link: r.href,
        })),
      );
    }

    if (name === "get_pipeline_summary") {
      if (!canAccessScreen(ctx, "crm")) return "Você não tem acesso ao CRM.";
      const period = asPeriod(input.period);
      const r = await getSalesReport(ctx.organizationId, period);
      return JSON.stringify({
        periodo: period,
        ganhos: r.won,
        perdidos: r.lost,
        cancelados: r.canceled,
        taxaConversao: `${Math.round(r.winRate * 100)}%`,
        valorGanho: formatBRL(r.wonValue),
        ticketMedio: formatBRL(r.avgTicket),
        cicloMedioDias: r.avgCycleDays,
        motivosPerda: r.lossReasons.slice(0, 5),
        funil: r.funnel.map((f) => ({ etapa: f.name, quantidade: f.count, valor: formatBRL(f.value) })),
      });
    }

    if (name === "get_opportunity") {
      if (!canAccessScreen(ctx, "crm")) return "Você não tem acesso ao CRM.";
      const id = typeof input.id === "string" ? input.id.trim() : "";
      if (!id) return "Informe o id da oportunidade (do link retornado pela busca).";
      const o = await getOpportunity(ctx.organizationId, id);
      if (!o) return "Oportunidade não encontrada.";
      return JSON.stringify({
        codigo: o.code,
        titulo: o.title,
        valor: formatBRL(o.value),
        etapa: o.stageName,
        status: o.status,
        empresa: o.companyName,
        contato: o.contactName,
        telefone: o.contactPhone,
        produto: o.productServiceName,
        responsavel: o.ownerName,
        previsaoFechamento: o.expectedCloseDate,
        motivoEncerramento: o.outcomeReason,
        notas: o.notes,
      });
    }

    if (name === "list_my_tasks") {
      if (!canAccessScreen(ctx, "tasks")) return "Você não tem acesso às Tarefas.";
      const scope = asTaskScope(input.scope);
      const rows = await listTasks(ctx.organizationId, { assignedToId: ctx.userId, scope });
      if (rows.length === 0) return "Nenhuma tarefa encontrada nesse filtro.";
      return JSON.stringify(
        rows.slice(0, 25).map((t) => ({
          titulo: t.title,
          status: t.status,
          prioridade: t.priority,
          vencimento: t.dueDate,
          oportunidade: t.opportunityTitle,
          contato: t.contactName,
        })),
      );
    }

    if (name === "list_message_templates") {
      if (!canAccessScreen(ctx, "inbox") && !canAccessScreen(ctx, "campaigns")) {
        return "Você não tem acesso aos modelos de mensagem.";
      }
      const rows = await listQuickReplies(ctx.organizationId);
      if (rows.length === 0) return "Nenhum modelo de mensagem cadastrado ainda.";
      return JSON.stringify(rows.slice(0, 30).map((r) => ({ nome: r.name, texto: r.body })));
    }

    if (name === "list_pipeline_stages") {
      if (!canAccessScreen(ctx, "crm")) return "Você não tem acesso ao CRM.";
      const { stages } = await stageOptions(ctx.organizationId);
      if (stages.length === 0) return "Nenhuma etapa encontrada.";
      return JSON.stringify(stages.map((s) => ({ id: s.id, etapa: s.name })));
    }

    if (name === "get_contact") {
      if (!canAccessScreen(ctx, "contacts")) return "Você não tem acesso aos contatos.";
      const id = typeof input.id === "string" ? input.id.trim() : "";
      if (!id) return "Informe o id do contato.";
      const c = await getContact(ctx.organizationId, id);
      if (!c) return "Contato não encontrado.";
      return JSON.stringify({
        nome: c.name,
        email: c.email,
        telefone: c.phone,
        cargo: c.role,
        empresa: c.company?.name ?? null,
        tags: c.tags,
      });
    }

    if (name === "get_company") {
      if (!canAccessScreen(ctx, "companies")) return "Você não tem acesso às empresas.";
      const id = typeof input.id === "string" ? input.id.trim() : "";
      if (!id) return "Informe o id da empresa.";
      const c = await getCompany(ctx.organizationId, id);
      if (!c) return "Empresa não encontrada.";
      return JSON.stringify(c);
    }

    return `Ferramenta desconhecida: ${name}`;
  } catch (e) {
    console.error(`[assistant] tool ${name} failed`, e);
    return "A ferramenta falhou ao executar. Tente novamente.";
  }
}
