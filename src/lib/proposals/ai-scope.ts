import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/assistant/client";
import { ASSISTANT_MODEL } from "@/lib/assistant/config";
import { tenantDb } from "@/lib/tenant-db";

/**
 * "Gerar escopo com IA" in the proposal form (request in the scope doc of 26/06: AI to draft the proposal's scope). One
 * Messages API call, no tools: the proposal as the form has it now (title, client, items), the linked opportunity read here
 * by tenantDb, the person's optional instruction and, to rewrite, the current text. It returns plain text for the "Introdução"
 * field (the document prints it as text, newlines kept), which the person reviews before saving: nothing is saved here.
 */

export type ScopeInput = {
  title: string;
  clientCompany: string;
  clientName: string;
  items: { name: string; description: string; quantity: number }[];
  opportunityId: string;
  /** What the person wants considered ("prazo de 60 dias, inclui ART"). */
  instruction: string;
  /** The field's current text: when present, the model rewrites it instead of starting over. */
  current: string;
};

export type ScopeOutcome = { ok: true; text: string } | { ok: false; error: "refused" | "unavailable" | "cut" | "unknown" };

/** The longest text the field takes (validations/proposal.ts: intro up to 12000). */
const MAX_TEXT = 12_000;
/** A request that hangs is cut before the host's own limit on the page's request. No automatic retry (the SDK would repeat
 * a timeout and double the wait): the person clicks again. A normal generation takes 10–15 s. */
const TIMEOUT_MS = 40_000;
/** Models that take the server-side refusal fallback (fallbacks: "default"); any other model goes without it. */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const SYSTEM = `Você escreve o texto de escopo de propostas comerciais de uma empresa brasileira, em português do Brasil, para o cliente ler.

O texto vai num campo de texto simples, impresso no documento da proposta. Por isso:
- Não use Markdown: nada de #, **, tabelas ou crases. Para listas, use linhas começando com "- ".
- Escreva em parágrafos curtos e, quando ajudar, uma lista do que está incluído.
- Tamanho: de 120 a 350 palavras.

Conteúdo:
- Diga o que será entregue, a partir do título, dos itens e das observações da oportunidade.
- Não invente preços, valores, quantidades, prazos, garantias, normas ou condições de pagamento. Use só o que estiver nos dados ou na instrução. Quando um dado importante faltar, escreva "[a definir]" no lugar, para a pessoa preencher.
- Não acrescente serviços ou materiais que não estejam nos itens, nas observações ou na instrução. Se as observações citam algo que não está nos itens, diga que esse ponto está "a confirmar".
- Não repita a tabela de itens com preços: ela já aparece no documento.
- Tom profissional e direto, sem exageros de marketing.
- Responda só com o texto do escopo, sem introdução sua nem comentários, e sem assinatura nem nome da empresa no fim.`;

/** The opportunity's own words, when the proposal is linked to one of this org's. */
async function opportunityFacts(organizationId: string, opportunityId: string): Promise<string[]> {
  if (!opportunityId) return [];
  const opp = await tenantDb(organizationId).opportunity.findFirst({
    where: { id: opportunityId },
    select: {
      title: true,
      notes: true,
      stage: { select: { name: true } },
      pipeline: { select: { name: true } },
      productService: { select: { name: true } },
      company: { select: { name: true } },
    },
  });
  if (!opp) return [];
  const facts = [`Oportunidade: ${opp.title}`];
  if (opp.pipeline?.name) facts.push(`Funil/etapa: ${opp.pipeline.name} / ${opp.stage?.name ?? ""}`);
  if (opp.company?.name) facts.push(`Empresa da oportunidade: ${opp.company.name}`);
  if (opp.productService?.name) facts.push(`Produto/serviço da oportunidade: ${opp.productService.name}`);
  if (opp.notes?.trim()) facts.push(`Observações da oportunidade:\n${opp.notes.trim().slice(0, 4000)}`);
  return facts;
}

function userMessage(input: ScopeInput, sellerName: string, facts: string[]): string {
  const lines = [`Empresa que envia a proposta: ${sellerName}`];
  if (input.title) lines.push(`Título da proposta: ${input.title}`);
  if (input.clientCompany || input.clientName) {
    lines.push(`Cliente: ${[input.clientCompany, input.clientName].filter(Boolean).join(" — ")}`);
  }
  const items = input.items.filter((i) => i.name.trim());
  if (items.length > 0) {
    lines.push(
      "Itens da proposta:",
      ...items.map((i) => `- ${i.name.trim()} (quantidade: ${i.quantity})${i.description.trim() ? `: ${i.description.trim()}` : ""}`),
    );
  }
  lines.push(...facts);
  const parts = [`<dados_da_proposta>\n${lines.join("\n")}\n</dados_da_proposta>`];
  if (input.instruction.trim()) parts.push(`<instrucao>\n${input.instruction.trim()}\n</instrucao>`);
  if (input.current.trim()) {
    parts.push(
      `<texto_atual>\n${input.current.trim()}\n</texto_atual>`,
      "Reescreva o texto atual seguindo as regras e a instrução, mantendo o que ele já diz de certo.",
    );
  } else {
    parts.push("Escreva o texto de escopo desta proposta.");
  }
  return parts.join("\n\n");
}

export async function draftProposalScope(
  organizationId: string,
  sellerName: string,
  input: ScopeInput,
): Promise<ScopeOutcome> {
  const anthropic = getAnthropic();
  if (!anthropic) return { ok: false, error: "unavailable" };
  const facts = await opportunityFacts(organizationId, input.opportunityId);

  try {
    const response = await anthropic.beta.messages.create(
      {
        model: ASSISTANT_MODEL,
        max_tokens: 8000,
        // A short, well-specified text: medium effort is enough, and it is set explicitly because the default differs
        // between models (high on Opus 5, medium on Opus 5.5).
        output_config: { effort: "medium" },
        system: SYSTEM,
        messages: [{ role: "user", content: userMessage(input, sellerName, facts) }],
        // On a safety decline, the API reruns the request on a fallback model inside the same call (only where supported).
        ...(FALLBACK_MODELS.has(ASSISTANT_MODEL)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      },
      { timeout: TIMEOUT_MS, maxRetries: 0 },
    );
    if (response.stop_reason === "refusal") return { ok: false, error: "refused" };
    // Cut at max_tokens (thinking shares them with the text): half a scope must not reach the field as if it were whole.
    if (response.stop_reason === "max_tokens") return { ok: false, error: "cut" };
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) return { ok: false, error: "unknown" };
    return { ok: true, text: text.slice(0, MAX_TEXT) };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      console.error("[proposal-scope] rate limited by the API");
      return { ok: false, error: "unavailable" };
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionError) {
      console.error("[proposal-scope] API connection failed", error.message);
      return { ok: false, error: "unavailable" };
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`[proposal-scope] API error ${error.status}`, error.message);
      // 5xx and 529 (overloaded) pass: "try again in a moment", like a 429.
      return { ok: false, error: (error.status ?? 0) >= 500 ? "unavailable" : "unknown" };
    }
    throw error;
  }
}
