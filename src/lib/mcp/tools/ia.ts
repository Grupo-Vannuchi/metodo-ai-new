import "server-only";
import { orgTool, type McpToolDef } from "@/lib/mcp/tool";
import { listAiAgents } from "@/lib/queries/mcp/ia";

export const iaTools: McpToolDef[] = [
  orgTool({
    name: "listar_agentes_ia",
    description:
      "Agentes de IA do WhatsApp (nome, ligado ou não, modelo, minutos de silêncio depois que um humano " +
      "responde e a conexão) e o uso do assistente do app (conversas e mensagens). O prompt dos agentes e " +
      "o conteúdo das conversas com o assistente não são expostos.",
    input: {},
    run: async (_args, org) => listAiAgents(org.id),
  }),
];
