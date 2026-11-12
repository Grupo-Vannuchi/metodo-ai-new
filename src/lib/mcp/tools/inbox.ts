import "server-only";
import { resolvePeriod } from "@/lib/mcp/core";
import { periodShape } from "@/lib/mcp/inputs";
import { orgTool, type McpToolDef } from "@/lib/mcp/tool";
import { conversationsSummary } from "@/lib/queries/mcp/inbox";

export const inboxTools: McpToolDef[] = [
  orgTool({
    name: "resumo_conversas",
    description:
      "Resumo do WhatsApp (Inbox) só com contagens: conexões e quantas conversas e mensagens não lidas cada " +
      "uma tem, conversas (total, grupos, com não lidas, sem responsável, ativas no período), mensagens " +
      "recebidas e enviadas no período (padrão: mês corrente até hoje) e conversas por responsável. Nenhum " +
      "conteúdo de mensagem, número ou nome de contato é exposto.",
    input: { ...periodShape },
    run: async ({ from, to }, org, now) => conversationsSummary(org.id, resolvePeriod(from, to, now)),
  }),
];
