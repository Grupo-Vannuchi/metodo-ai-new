import "server-only";
import { z } from "zod";
import { listResult, page, resolvePeriod, resolveRange } from "@/lib/mcp/core";
import { pageShape, periodShape, searchParam } from "@/lib/mcp/inputs";
import { orgTool, type McpToolDef } from "@/lib/mcp/tool";
import { searchTasks, tasksSummary } from "@/lib/queries/mcp/tarefas";

export const tarefasTools: McpToolDef[] = [
  orgTool({
    name: "buscar_tarefas",
    description:
      "Busca as tarefas com tipo, prioridade, status, progresso, datas, responsável e a empresa, contato " +
      "ou oportunidade ligados. overdue = em aberto e vencida antes de hoje (horário de Brasília), como na " +
      "tela Tarefas. O período vale para o vencimento.",
    input: {
      status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional().describe("TODO, IN_PROGRESS ou DONE"),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().describe("LOW, MEDIUM ou HIGH"),
      type: z
        .enum(["CALL", "MEETING", "EMAIL", "WHATSAPP", "FOLLOWUP", "OTHER"])
        .optional()
        .describe("CALL, MEETING, EMAIL, WHATSAPP, FOLLOWUP ou OTHER"),
      assignedToId: z.string().min(1).optional().describe("Id do responsável (userId de listar_membros)"),
      overdue: z.boolean().optional().describe("true = só atrasadas; false = só as que não estão atrasadas"),
      search: searchParam,
      ...periodShape,
      ...pageShape,
    },
    run: async ({ status, priority, type, assignedToId, overdue, search, from, to, limit, offset }, org, now) => {
      const p = page(limit, offset);
      const { total, items } = await searchTasks(
        org.id,
        { status, priority, type, assignedToId, overdue, search, range: resolveRange(from, to), page: p },
        now,
      );
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "resumo_tarefas",
    description:
      "Resumo das tarefas: abertas agora (a fazer e em andamento), atrasadas agora, criadas e concluídas no " +
      "período (padrão: mês corrente até hoje), e esses números por responsável.",
    input: { ...periodShape },
    run: async ({ from, to }, org, now) => tasksSummary(org.id, resolvePeriod(from, to, now), now),
  }),
];
