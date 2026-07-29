import { getOrgContext } from "@/lib/tenant";
import { hasFeature, type PlanKey } from "@/config/plans";
import { makeRateLimiter } from "@/lib/ratelimit";
import { executeWrite, isWriteTool } from "@/lib/assistant/writes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Executes a write the copilot proposed, AFTER the user confirmed it on screen.
 * The model never reaches this endpoint; only a user click does. Same gating +
 * tenant scoping + audit as everything else.
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return json({ ok: false, message: "unauthorized" }, 401);
  if (!hasFeature(ctx.organization.plan as PlanKey, "assistant")) {
    return json({ ok: false, message: "forbidden" }, 403);
  }

  const limiter = makeRateLimiter("assistant-exec", 30, 60);
  if (limiter) {
    const { success } = await limiter.limit(`${ctx.organizationId}:${ctx.userId}`);
    if (!success) return json({ ok: false, message: "Muitas ações em pouco tempo. Aguarde." }, 429);
  }

  let body: { tool?: unknown; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: "invalid" }, 400);
  }
  const tool = typeof body.tool === "string" ? body.tool : "";
  if (!isWriteTool(tool)) return json({ ok: false, message: "Ação inválida." }, 400);
  const args =
    body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};

  const result = await executeWrite(ctx, tool, args);
  return json(result, result.ok ? 200 : 400);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
