import "server-only";
import { z } from "zod";
import { listResult, page, resolvePeriod, resolveRange } from "@/lib/mcp/core";
import { pageShape, periodShape, searchParam } from "@/lib/mcp/inputs";
import { orgTool, type McpToolDef } from "@/lib/mcp/tool";
import {
  salesSummary,
  searchCompanies,
  searchContacts,
  searchOpportunities,
  searchProposals,
} from "@/lib/queries/mcp/crm";

const idParam = (what: string) => z.string().min(1).optional().describe(`Id ${what}`);

const opportunityStatus = z
  .enum(["OPEN", "ON_HOLD", "WON", "LOST", "CANCELED"])
  .optional()
  .describe("Status: OPEN (aberta), ON_HOLD (em espera), WON (ganha), LOST (perdida), CANCELED (cancelada)");

const proposalStatus = z
  .enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"])
  .optional()
  .describe("Status: DRAFT (rascunho), SENT (enviada), ACCEPTED (aceita), REJECTED (recusada), EXPIRED (expirada)");

export const crmTools: McpToolDef[] = [
  orgTool({
    name: "buscar_empresas",
    description:
      "Busca as empresas (clientes e prospects) do CRM por nome, CNPJ ou e-mail. Traz contato, cidade/UF, " +
      "origem e quantos contatos e oportunidades abertas cada uma tem.",
    input: { search: searchParam, ...pageShape },
    run: async ({ search, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchCompanies(org.id, { search, page: p });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "buscar_contatos",
    description:
      "Busca as pessoas do CRM por nome, e-mail ou telefone, opcionalmente de uma empresa ou com uma tag. " +
      "optedOut = pediu para não receber campanhas.",
    input: {
      search: searchParam,
      companyId: idParam("da empresa do CRM (veja buscar_empresas)"),
      tag: z.string().min(1).optional().describe("Tag exata do contato"),
      ...pageShape,
    },
    run: async ({ search, companyId, tag, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchContacts(org.id, { search, companyId, tag, page: p });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "buscar_oportunidades",
    description:
      "Busca as oportunidades (negócios do funil) com valor, status, funil, etapa, empresa, contato e " +
      "responsável. Filtra por status, funil, etapa, responsável (userId de listar_membros), empresa, " +
      "texto do título/código e período — o período vale para a data escolhida em dateField " +
      "(criação, fechamento ou previsão de fechamento).",
    input: {
      status: opportunityStatus,
      pipelineId: idParam("do funil"),
      stageId: idParam("da etapa"),
      ownerId: idParam("do responsável (userId de listar_membros)"),
      companyId: idParam("da empresa do CRM"),
      search: searchParam,
      dateField: z
        .enum(["createdAt", "closedAt", "expectedCloseDate"])
        .optional()
        .describe("A qual data o período se aplica (padrão createdAt)"),
      ...periodShape,
      ...pageShape,
    },
    run: async ({ status, pipelineId, stageId, ownerId, companyId, search, dateField, from, to, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchOpportunities(org.id, {
        status,
        pipelineId,
        stageId,
        ownerId,
        companyId,
        search,
        dateField: dateField ?? "createdAt",
        range: resolveRange(from, to),
        page: p,
      });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "buscar_propostas",
    description:
      "Busca as propostas comerciais com status, valores (subtotal, desconto, total), cliente, " +
      "responsável e datas de envio/decisão. Período aplicado à data de criação.",
    input: {
      status: proposalStatus,
      companyId: idParam("da empresa do CRM"),
      search: searchParam,
      ...periodShape,
      ...pageShape,
    },
    run: async ({ status, companyId, search, from, to, limit, offset }, org) => {
      const p = page(limit, offset);
      const { total, items } = await searchProposals(org.id, {
        status,
        companyId,
        search,
        range: resolveRange(from, to),
        page: p,
      });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "resumo_vendas",
    description:
      "Relatório de vendas de um período (padrão: mês corrente até hoje): oportunidades criadas, ganhas, " +
      "perdidas e canceladas (com valores), taxa de conversão (ganhas ÷ ganhas+perdidas), motivos de " +
      "perda, desempenho e meta por responsável e propostas por status. openFunnel é o retrato do funil " +
      "agora (oportunidades abertas por etapa) de um funil só: o pipelineId informado, senão o padrão.",
    input: { ...periodShape, pipelineId: idParam("do funil para o retrato openFunnel") },
    run: async ({ from, to, pipelineId }, org, now) =>
      salesSummary(org.id, resolvePeriod(from, to, now), pipelineId),
  }),
];
