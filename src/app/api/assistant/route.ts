import type Anthropic from "@anthropic-ai/sdk";
import { getOrgContext } from "@/lib/tenant";
import { hasFeature, type PlanKey } from "@/config/plans";
import { makeRateLimiter } from "@/lib/ratelimit";
import { getAnthropic } from "@/lib/assistant/client";
import { ASSISTANT_MODEL, isAssistantConfigured } from "@/lib/assistant/config";
import { buildSystemPrompt } from "@/lib/assistant/system";
import { assistantTools, runAssistantTool } from "@/lib/assistant/tools";
import { appendMessage, getOrCreateThread, loadHistory } from "@/lib/assistant/threads";
import type { AssistantScreenContext } from "@/lib/assistant/context";

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

  let body: { message?: unknown; screen?: AssistantScreenContext };
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

  const anthropic = getAnthropic();
  if (!anthropic) return json({ error: "not_configured" }, 503);

  const thread = await getOrCreateThread(ctx.organizationId, ctx.userId);
  const history = await loadHistory(ctx.organizationId, thread.id);
  await appendMessage(ctx.organizationId, thread.id, "user", userMessage);

  const system = buildSystemPrompt(ctx, screen);
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
            tools: assistantTools,
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
            const out = await runAssistantTool(
              ctx,
              tu.name,
              (tu.input ?? {}) as Record<string, unknown>,
            );
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
