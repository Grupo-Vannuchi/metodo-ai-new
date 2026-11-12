import "server-only";
import { z } from "zod";
import { listResult, page, resolvePeriod, resolveRange } from "@/lib/mcp/core";
import { pageShape, periodShape, searchParam } from "@/lib/mcp/inputs";
import { orgTool, type McpToolDef } from "@/lib/mcp/tool";
import {
  searchAssets,
  searchMovements,
  searchPurchaseOrders,
  searchStock,
  suppliesSummary,
} from "@/lib/queries/mcp/suprimentos";

const idParam = (what: string) => z.string().min(1).optional().describe(`Id ${what}`);

export const suprimentosTools: McpToolDef[] = [
  orgTool({
    name: "buscar_itens_estoque",
    description:
      "Saldo de estoque por item, com reservado, disponível e mínimo — os mesmos números da tela Estoque. " +
      "belowMin = abaixo do estoque mínimo. Busca pela descrição ou código.",
    input: {
      search: searchParam,
      belowMin: z.boolean().optional().describe("true = só itens abaixo do mínimo; false = só os demais"),
      ...pageShape,
    },
    run: async ({ search, belowMin, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchStock(org.id, { search, belowMin, page: p });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "buscar_movimentacoes",
    description:
      "Movimentações de estoque (entradas, saídas, ajustes e transferências) com item, almoxarifado, " +
      "quantidade, custo, lote, validade, motivo e referência. Período aplicado à data da movimentação.",
    input: {
      itemId: idParam("do item (itemId de buscar_itens_estoque)"),
      warehouseId: idParam("do almoxarifado"),
      type: z
        .enum(["IN", "OUT", "ADJUST", "TRANSFER_IN", "TRANSFER_OUT"])
        .optional()
        .describe("IN (entrada), OUT (saída), ADJUST (ajuste), TRANSFER_IN/TRANSFER_OUT (transferência)"),
      ...periodShape,
      ...pageShape,
    },
    run: async ({ itemId, warehouseId, type, from, to, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchMovements(org.id, {
        itemId,
        warehouseId,
        type,
        range: resolveRange(from, to),
        page: p,
      });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "buscar_pedidos_compra",
    description:
      "Pedidos de compra com status, fornecedor, almoxarifado de destino, total, número de linhas e datas " +
      "(previsão, aprovação, pedido, recebimento). Período aplicado à data de criação.",
    input: {
      status: z
        .enum(["DRAFT", "APPROVED", "ORDERED", "PARTIAL", "RECEIVED", "CANCELED"])
        .optional()
        .describe("DRAFT, APPROVED, ORDERED, PARTIAL (recebido em parte), RECEIVED ou CANCELED"),
      supplierId: idParam("do fornecedor"),
      ...periodShape,
      ...pageShape,
    },
    run: async ({ status, supplierId, from, to, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchPurchaseOrders(org.id, {
        status,
        supplierId,
        range: resolveRange(from, to),
        page: p,
      });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "buscar_ativos",
    description:
      "Ativos (patrimônio, equipamentos de clientes e itens de terceiros) com status, local, responsável, " +
      "aquisição e a próxima manutenção ou calibração agendada. Busca por nome, código ou número de série.",
    input: {
      status: z
        .enum(["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"])
        .optional()
        .describe("AVAILABLE, IN_USE, MAINTENANCE ou RETIRED"),
      search: searchParam,
      ...pageShape,
    },
    run: async ({ status, search, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchAssets(org.id, { status, search, page: p });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "resumo_suprimentos",
    description:
      "Indicadores de Suprimentos como na tela inicial do módulo (itens abaixo do mínimo, valor em estoque, " +
      "compras em aberto, ativos, manutenções atrasadas e próximas, equipamentos de clientes) e a atividade " +
      "do período (padrão: mês corrente até hoje): pedidos de compra por status, movimentações por tipo e " +
      "ordens de serviço recebidas por status.",
    input: { ...periodShape },
    run: async ({ from, to }, org, now) => suppliesSummary(org.id, resolvePeriod(from, to, now)),
  }),
];
