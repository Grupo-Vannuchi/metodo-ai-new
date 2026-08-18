import type Anthropic from "@anthropic-ai/sdk";
import { getOrgContext } from "@/lib/tenant";
import { hasFeatureByModules } from "@/config/modules";
import { makeRateLimiter } from "@/lib/ratelimit";
import { getAnthropic } from "@/lib/assistant/client";
import { ASSISTANT_MODEL, isAssistantConfigured } from "@/lib/assistant/config";
import { isAssistantOverDailyLimit } from "@/lib/assistant/quota";
import { buildSystemPrompt } from "@/lib/assistant/system";
import { assistantTools, runAssistantTool } from "@/lib/assistant/tools";
import { buildPlanTool, isWriteTool, PLAN_TOOL_NAME, summarizeWrite, writeToolsFor } from "@/lib/assistant/writes";
import { generateImage, IMAGE_TOOL_NAME, imageGenTool, isImageGenConfigured } from "@/lib/assistant/image-gen";
import { appendMessage, loadHistory, resolveThread, setThreadTitle } from "@/lib/assistant/threads";
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

  if (!hasFeatureByModules(ctx.modules, "assistant")) {
    return json({ error: "forbidden" }, 403);
  }
  if (!isAssistantConfigured()) return json({ error: "not_configured" }, 503);

  if (await isAssistantOverDailyLimit(ctx.organizationId)) {
    return json({ error: "daily_limit" }, 429);
  }

  const limiter = makeRateLimiter("assistant", 30, 60);
  if (limiter) {
    const { success } = await limiter.limit(`${ctx.organizationId}:${ctx.userId}`);
    if (!success) return json({ error: "rate_limited" }, 429);
  }

  let body: {
    message?: unknown;
    screen?: AssistantScreenContext;
    form?: unknown;
    threadId?: unknown;
    images?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const userMessage = typeof body.message === "string" ? body.message.trim() : "";
  const images = parseImages(body.images);
  if (!userMessage && images.length === 0) return json({ error: "invalid" }, 400);
  const requestedThreadId = typeof body.threadId === "string" ? body.threadId : null;
  const screen: AssistantScreenContext =
    body.screen && typeof body.screen.screen === "string"
      ? body.screen
      : { screen: "dashboard", path: "/app" };
  const form = asFormDescriptor(body.form);

  const anthropic = getAnthropic();
  if (!anthropic) return json({ error: "not_configured" }, 503);

  const thread = await resolveThread(ctx.organizationId, ctx.userId, requestedThreadId);
  const history = await loadHistory(ctx.organizationId, thread.id);
  const storedText = userMessage || "[imagem]";
  await appendMessage(ctx.organizationId, thread.id, "user", storedText);
  if (!thread.title) await setThreadTitle(ctx.organizationId, thread.id, storedText);

  let system = buildSystemPrompt(ctx, screen);
  if (form) {
    system += `\nO usuário está com o formulário "${form.title}" aberto na tela. Se ele pedir para preencher, rascunhar ou montar esse formulário, use a ferramenta prefill_form — ela apenas preenche os campos visíveis para o usuário revisar e salvar (não salva nada). Preencha só os campos que fizerem sentido.`;
  }
  const tools = [
    ...assistantTools,
    ...writeToolsFor(ctx),
    buildPlanTool(ctx),
    ...(isImageGenConfigured() ? [imageGenTool] : []),
    ...(form ? [buildPrefillTool(form)] : []),
  ];
  const lastContent: Anthropic.MessageParam["content"] =
    images.length > 0
      ? [
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
          })),
          { type: "text" as const, text: userMessage || "Analise a imagem enviada." },
        ]
      : userMessage;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    })),
    { role: "user" as const, content: lastContent },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      send({ type: "thread", id: thread.id });
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
            if (tu.name === IMAGE_TOOL_NAME) {
              const a = (tu.input ?? {}) as Record<string, unknown>;
              const prompt = typeof a.prompt === "string" ? a.prompt : "";
              const shape = typeof a.shape === "string" ? a.shape : undefined;
              const r = prompt ? await generateImage(prompt, shape) : ({ ok: false, error: "invalid" } as const);
              if (r.ok) {
                send({ type: "image", b64: r.b64, mediaType: r.mediaType });
                out = "Imagem gerada e exibida ao usuário (ele pode baixá-la). Comente brevemente e ofereça ajustes se quiser.";
              } else if (r.error === "not_configured") {
                out = "A geração de imagens não está configurada.";
              } else if (r.error === "billing") {
                out =
                  "Não foi possível gerar: a conta de imagens está sem créditos ou atingiu o limite de cobrança. Avise o usuário para adicionar créditos/ajustar o limite na OpenAI.";
              } else {
                out = "Não consegui gerar a imagem agora.";
              }
            } else if (tu.name === PLAN_TOOL_NAME) {
              const steps = sanitizePlan(tu.input);
              send({ type: "plan", id: tu.id, title: planTitle(tu.input), steps });
              out =
                "Plano preparado. O usuário verá um cartão para aprovar ou cancelar o processo inteiro — NÃO execute os passos de novo; apenas peça a aprovação de forma breve.";
            } else if (isWriteTool(tu.name)) {
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

type Img = { mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string };
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Validate up to 4 base64 images from the client (vision input). */
function parseImages(input: unknown): Img[] {
  if (!Array.isArray(input)) return [];
  const out: Img[] = [];
  for (const raw of input.slice(0, 4)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const mediaType = typeof o.mediaType === "string" ? o.mediaType : "";
    const data = typeof o.data === "string" ? o.data : "";
    if (!IMAGE_TYPES.has(mediaType) || data.length < 16) continue;
    out.push({ mediaType: mediaType as Img["mediaType"], data });
  }
  return out;
}

function planTitle(input: unknown): string {
  const t = input && typeof input === "object" ? (input as Record<string, unknown>).title : null;
  return typeof t === "string" && t.trim() ? t : "Processo";
}

/** Narrow plan steps to write tools with an object args bag. */
function sanitizePlan(
  input: unknown,
): { tool: string; summary: string; args: Record<string, unknown> }[] {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>).steps : null;
  if (!Array.isArray(raw)) return [];
  const out: { tool: string; summary: string; args: Record<string, unknown> }[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const step = s as Record<string, unknown>;
    const tool = typeof step.tool === "string" ? step.tool : "";
    if (!isWriteTool(tool)) continue;
    out.push({
      tool,
      summary: typeof step.summary === "string" ? step.summary : summarizeWrite(tool, (step.args ?? {}) as Record<string, unknown>),
      args: step.args && typeof step.args === "object" ? (step.args as Record<string, unknown>) : {},
    });
  }
  return out;
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
