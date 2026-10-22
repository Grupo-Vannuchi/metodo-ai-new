import "server-only";
import type { McpToolDef } from "@/lib/mcp/tool";
import { crmTools } from "@/lib/mcp/tools/crm";
import { plataformaTools } from "@/lib/mcp/tools/plataforma";

/** Every tool the server exposes, in the order tools/list shows them. */
export const ALL_TOOLS: McpToolDef[] = [...plataformaTools, ...crmTools];
