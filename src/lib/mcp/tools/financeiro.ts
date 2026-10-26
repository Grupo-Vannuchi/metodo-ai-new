import "server-only";
import { z } from "zod";
import { listResult, page, resolvePeriod, resolveRange } from "@/lib/mcp/core";
import { pageShape, periodShape, searchParam } from "@/lib/mcp/inputs";
import { orgTool, type McpToolDef } from "@/lib/mcp/tool";
import { financeSummary, searchEntries } from "@/lib/queries/mcp/financeiro";

export const financeiroTools: McpToolDef[] = [
  orgTool({
    name: "buscar_lancamentos",
    description:
      "Busca os lançamentos financeiros (receitas e despesas) com valor, status, vencimento, pagamento, " +
      "categoria e o cliente/oportunidade ligados. O período vale para o vencimento. Lançamentos de " +
      "folha de pagamento NÃO aparecem aqui (nunca há valor por pessoa): o total da folha está em " +
      "resumo_financeiro, na linha \"Folha de pagamento\".",
    input: {
      type: z.enum(["INCOME", "EXPENSE"]).optional().describe("INCOME (receita) ou EXPENSE (despesa)"),
      status: z
        .enum(["PENDING", "SETTLED"])
        .optional()
        .describe("PENDING (a receber/a pagar) ou SETTLED (recebido/pago)"),
      categoryName: z.string().min(1).optional().describe("Nome exato da categoria"),
      search: searchParam,
      ...periodShape,
      ...pageShape,
    },
    run: async ({ type, status, categoryName, search, from, to, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchEntries(org.id, {
        type,
        status,
        categoryName,
        search,
        range: resolveRange(from, to),
        page: p,
      });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "resumo_financeiro",
    description:
      "Resumo financeiro de um período (padrão: mês corrente até hoje). Onde cada número bate com a tela " +
      "Financeiro: competencia = DRE (vencimento no período, receitas e despesas por categoria); caixa = " +
      "Fluxo de Caixa (recebido e pago no período); emAberto = cards A receber / A pagar (tudo em aberto, " +
      "de qualquer vencimento); saldoRealizado = card Saldo (todo o histórico). Também: pendente (em aberto " +
      "com vencimento no período) e vencidos (em aberto com vencimento antes de hoje). A folha de pagamento " +
      "aparece somada numa única linha \"Folha de pagamento\", sem valor por pessoa.",
    input: { ...periodShape },
    run: async ({ from, to }, org, now) => financeSummary(org.id, resolvePeriod(from, to, now), now),
  }),
];
