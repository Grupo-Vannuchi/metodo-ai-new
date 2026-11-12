import "server-only";
import { z } from "zod";
import { listResult, page, resolvePeriod } from "@/lib/mcp/core";
import { pageShape, periodShape, searchParam } from "@/lib/mcp/inputs";
import { orgTool, type McpToolDef } from "@/lib/mcp/tool";
import { hrSummary, searchEmployees } from "@/lib/queries/mcp/rh";

export const rhTools: McpToolDef[] = [
  orgTool({
    name: "buscar_funcionarios",
    description:
      "Lista os funcionários com nome, cargo, departamento, status e datas de admissão e desligamento. " +
      "Salário, folha, dados bancários, documentos, endereço e contatos pessoais não são expostos.",
    input: {
      status: z
        .enum(["ACTIVE", "ON_LEAVE", "TERMINATED"])
        .optional()
        .describe("ACTIVE (ativo), ON_LEAVE (afastado) ou TERMINATED (desligado)"),
      departmentId: z.string().min(1).optional().describe("Id do departamento"),
      search: searchParam,
      ...pageShape,
    },
    run: async ({ status, departmentId, search, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchEmployees(org.id, { status, departmentId, search, page: p });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "resumo_rh",
    description:
      "Resumo de pessoas de um período (padrão: mês corrente até hoje), só com contagens: quadro por " +
      "status e por departamento, admissões e desligamentos no período, ausências pendentes, ausências " +
      "aprovadas que começam no período (por tipo, com dias) e quantos estão ausentes hoje. Não traz " +
      "nomes nem salários.",
    input: { ...periodShape },
    run: async ({ from, to }, org, now) => hrSummary(org.id, resolvePeriod(from, to, now), now),
  }),
];
