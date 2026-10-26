import "server-only";
import type { McpToolDef } from "@/lib/mcp/tool";
import { crmTools } from "@/lib/mcp/tools/crm";
import { financeiroTools } from "@/lib/mcp/tools/financeiro";
import { iaTools } from "@/lib/mcp/tools/ia";
import { inboxTools } from "@/lib/mcp/tools/inbox";
import { marketingTools } from "@/lib/mcp/tools/marketing";
import { plataformaTools } from "@/lib/mcp/tools/plataforma";
import { rhTools } from "@/lib/mcp/tools/rh";
import { suprimentosTools } from "@/lib/mcp/tools/suprimentos";
import { tarefasTools } from "@/lib/mcp/tools/tarefas";

/** Every tool the server exposes, in the order tools/list shows them. */
export const ALL_TOOLS: McpToolDef[] = [
  ...plataformaTools,
  ...crmTools,
  ...financeiroTools,
  ...rhTools,
  ...suprimentosTools,
  ...marketingTools,
  ...inboxTools,
  ...iaTools,
  ...tarefasTools,
];
