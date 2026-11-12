import "server-only";
import { listResult, page } from "@/lib/mcp/core";
import { pageShape, searchParam } from "@/lib/mcp/inputs";
import { globalTool, orgTool, type McpToolDef } from "@/lib/mcp/tool";
import { listMembers, listOrganizations, organizationSummary } from "@/lib/queries/mcp/plataforma";

export const plataformaTools: McpToolDef[] = [
  globalTool({
    name: "listar_organizacoes",
    description:
      "Lista as organizações (empresas) da plataforma com o dono, o número de membros e o estado de " +
      "cada módulo (ACTIVE = instalado; DORMANT = desinstalado, com os dados mantidos). Use para achar o " +
      "organizationId que as outras ferramentas pedem. Busca por nome ou slug.",
    input: { search: searchParam, ...pageShape },
    run: async ({ search, limit, offset }) => {
      const p = page(limit, offset);
      const { total, items } = await listOrganizations({ search, ...p });
      return listResult(total, p, items);
    },
  }),
  orgTool({
    name: "listar_membros",
    description:
      "Lista os usuários com acesso à organização: nome, e-mail, papel (OWNER, ADMIN ou MEMBER) e desde " +
      "quando. Os userId servem de filtro de responsável nas outras ferramentas.",
    input: {},
    run: async (_args, org) => ({ items: await listMembers(org.id) }),
  }),
  orgTool({
    name: "resumo_organizacao",
    description:
      "Visão geral de uma organização: estado de cada módulo e quantos registros ela tem (membros, " +
      "empresas e contatos do CRM, oportunidades abertas, propostas, lançamentos financeiros sem a folha, " +
      "funcionários ativos, itens e pedidos de compra abertos, ativos, tarefas abertas, campanhas, " +
      "disparos de e-mail, conversas e a prospecção).",
    input: {},
    run: async (_args, org) => organizationSummary(org.id),
  }),
];
