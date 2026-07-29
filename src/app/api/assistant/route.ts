import type Anthropic from "@anthropic-ai/sdk";
import { getOrgContext } from "@/lib/tenant";
import { hasFeature, type PlanKey } from "@/config/plans";
import { makeRateLimiter } from "@/lib/ratelimit";
import { getAnthropic } from "@/lib/assistant/client";
import { ASSISTANT_MODEL, isAssistantConfigured } from "@/lib/assistant/config";
import { buildSystemPrompt } from "@/lib/assistant/system";
import { assistantTools, runAssistantTool } from "@/lib/assistant/tools";
import { isWriteTool, summarizeWrite, writeToolsFor } from "@/lib/assistant/writes";
import { appendMessage, getOrCreateThread, loadHistory } from "@/lib/assistant/threads";
import type { AssistantScreenContext } from "@/lib/assistant/context";
import type { FormDescriptor } from "@/lib/assistant/form-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TOOL_ROUNDS = 5;

/**
 * The AI copilot endpoint. Streams NDJSON events ({type:"text"|"tool"|"done"}).
 * Every tool runs under the caller's org context; the model never touches the
 * DB directly. Read-only in Phase 0.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return json({ error: "unauthorized" }, 401);

  if (!hasFeature(ctx.organization.plan as PlanKey, "assistant")) {
    return json({ error: "forbidden" }, 403);
  }
  if (!isAssistantConfigured()) return json({ error: "not_configured" }, 503);

  const limiter = makeRateLimiter("assistant", 30, 60);
  if (limiter) {
    const { success } = await limiter.limit(`${ctx.organizationId}:${ctx.userId}`);
    if (!success) return json({ error: "rate_limited" }, 429);
  }

  let body: { message?: unknown; screen?: AssistantScreenContext; form?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const userMessage = typeof body.message === "string" ? body.message.trim() : "";
  if (!userMessage) return json({ error: "invalid" }, 400);
  const screen: AssistantScreenContext =
    body.screen && typeof body.screen.screen === "string"
      ? body.screen
      : { screen: "dashboard", path: "/app" };
  const form = asFormDescriptor(body.form);

  const anthropic = getAnthropic();
  if (!anthropic) return json({ error: "not_configured" }, 503);

  const thread = await getOrCreateThread(ctx.organizationId, ctx.userId);
  const history = await loadHistory(ctx.organizationId, thread.id);
  await appendMessage(ctx.organizationId, thread.id, "user", userMessage);

  let system = buildSystemPrompt(ctx, screen);
  if (form) {
    system += `\nO usuário está com o formulário "${form.title}" aberto na tela. Se ele pedir para preencher, rascunhar ou montar esse formulário, use a ferramenta prefill_form — ela apenas preenche os campos visíveis para o usuário revisar e salvar (não salva nada). Preencha só os campos que fizerem sentido.`;
  }
  const tools = [
    ...assistantTools,
    ...writeToolsFor(ctx),
    ...(form ? [buildPrefillTool(form)] : []),
  ];
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      let assistantText = "";
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const turn = anthropic.messages.stream({
            model: ASSISTANT_MODEL,
            max_tokens: 2048,
            system,
            tools,
            messages,
          });
          turn.on("text", (delta) => {
            assistantText += delta;
            send({ type: "text", text: delta });
          });
          const msg = await turn.finalMessage();

          if (msg.stop_reason !== "tool_use") break;

          const toolUses = msg.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          messages.push({ role: "assistant", content: msg.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool", name: tu.name });
            let out: string;
            if (isWriteTool(tu.name)) {
              const args = (tu.input ?? {}) as Record<string, unknown>;
              send({ type: "confirm", id: tu.id, tool: tu.name, summary: summarizeWrite(tu.name, args), args });
              out =
                "Ação preparada. O usuário verá um cartão para confirmar ou cancelar na tela — NÃO execute de novo; apenas peça a confirmação de forma breve.";
            } else if (form && tu.name === "prefill_form") {
              const values = sanitizePrefill(form, tu.input);
              send({ type: "prefill", formKey: form.key, values });
              out =
                "Formulário preenchido na tela do usuário. Peça para ele revisar e salvar — nada foi salvo ainda.";
            } else {
              out = await runAssistantTool(ctx, tu.name, (tu.input ?? {}) as Record<string, unknown>);
            }
            results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
          }
          messages.push({ role: "user", content: results });
        }

        if (assistantText.trim()) {
          await appendMessage(ctx.organizationId, thread.id, "assistant", assistantText);
        }
        send({ type: "done" });
      } catch (e) {
        console.error("[assistant] stream failed", e);
        send({ type: "error", message: "Não consegui gerar a resposta agora." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Validate/narrow the client-sent open-form descriptor. */
function asFormDescriptor(v: unknown): FormDescriptor | null {
  if (!v || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  if (typeof f.key !== "string" || typeof f.title !== "string" || !Array.isArray(f.fields)) return null;
  const fields = f.fields
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .filter((x) => typeof x.name === "string" && typeof x.type === "string");
  if (fields.length === 0) return null;
  return v as FormDescriptor;
}

/** A per-request tool that mirrors the open form's fields. */
function buildPrefillTool(form: FormDescriptor): Anthropic.Tool {
  const properties: Record<string, unknown> = {};
  for (const f of form.fields) {
    if (f.type === "select" && f.options?.length) {
      properties[f.name] = {
        type: "string",
        enum: f.options.map((o) => o.value),
        description: `${f.label}. Valores: ${f.options.map((o) => `${o.value}=${o.label}`).join("; ")}`,
      };
    } else {
      properties[f.name] = {
        type: "string",
        description: f.description || f.label + (f.type === "date" ? " (formato AAAA-MM-DD)" : ""),
      };
    }
  }
  return {
    name: "prefill_form",
    description: `Preenche o formulário aberto na tela ("${form.title}") com os valores propostos, para o usuário revisar e salvar. NÃO salva nada — só preenche os campos visíveis. Inclua apenas os campos que fizer sentido preencher.`,
    input_schema: { type: "object", properties } as Anthropic.Tool.InputSchema,
  };
}

/** Keep only declared fields; select values must be within their options. */
function sanitizePrefill(form: FormDescriptor, input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  const rec = input as Record<string, unknown>;
  for (const f of form.fields) {
    const v = rec[f.name];
    if (v == null) continue;
    const s = String(v);
    if (f.type === "select") {
      if (f.options?.some((o) => o.value === s)) out[f.name] = s;
    } else {
      out[f.name] = s;
    }
  }
  return out;
}
