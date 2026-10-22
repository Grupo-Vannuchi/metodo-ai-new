import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "@/lib/mcp/tool";
import { ALL_TOOLS } from "@/lib/mcp/tools";

/** What the model reads when it connects (shown before any tool is called). */
const INSTRUCTIONS =
  "Servidor só de leitura com os dados de todas as organizações (empresas) do MétodoAI. " +
  "Use listar_organizacoes para achar o organizationId que as demais ferramentas pedem. " +
  "Datas no formato AAAA-MM-DD; valores em reais vêm como texto com duas casas decimais.";

/**
 * A fresh server per request: the transport is stateless (src/lib/mcp/handler.ts),
 * so nothing carries over between calls.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "metodoai", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, ALL_TOOLS);
  return server;
}
