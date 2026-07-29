import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { OrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { hasFeature, type PlanKey } from "@/config/plans";
import { globalSearch } from "@/lib/queries/search";

/**
 * Phase 0 tool set: read-only. Every tool executes under the caller's org
 * context (tenant-scoped) and respects the same screen access the UI enforces.
 * Write tools (create task, move opportunity, draft/send message…) arrive in
 * later phases behind explicit confirmation.
 */
export const assistantTools: Anthropic.Tool[] = [
  {
    name: "search_crm",
    description:
      "Busca no CRM por contatos, empresas, oportunidades, conversas do WhatsApp e lançamentos financeiros a partir de um termo. Retorna itens com tipo, título, subtítulo, detalhes e link. Use para localizar registros reais antes de responder.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Termo de busca — nome, empresa, telefone, código da oportunidade, etc.",
        },
      },
      required: ["query"],
    },
  },
];

/** Execute a tool call under the caller's org context. Never throws. */
export async function runAssistantTool(
  ctx: OrgContext,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    if (name === "search_crm") {
      const query = typeof input.query === "string" ? input.query : "";
      if (query.trim().length < 2) return "Informe um termo de busca com pelo menos 2 caracteres.";
      const canFinance =
        hasFeature(ctx.organization.plan as PlanKey, "finance") && canAccessScreen(ctx, "finance");
      const results = await globalSearch(ctx.organizationId, query, {
        allowed: (screen) => canAccessScreen(ctx, screen),
        canFinance,
        viewer: { userId: ctx.userId, role: ctx.role },
      });
      if (results.length === 0) return "Nenhum resultado encontrado.";
      return JSON.stringify(
        results.slice(0, 8).map((r) => ({
          tipo: r.type,
          titulo: r.title,
          subtitulo: r.subtitle,
          detalhes: r.meta,
          link: r.href,
        })),
      );
    }
    return `Ferramenta desconhecida: ${name}`;
  } catch (e) {
    console.error(`[assistant] tool ${name} failed`, e);
    return "A ferramenta falhou ao executar. Tente novamente.";
  }
}
