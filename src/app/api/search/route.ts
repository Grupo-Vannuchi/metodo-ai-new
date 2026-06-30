import { getOrgContext } from "@/lib/tenant";
import { canAccessScreen } from "@/lib/access";
import { globalSearch } from "@/lib/queries/search";
import { hasFeature, type PlanKey } from "@/config/plans";

export const runtime = "nodejs";

/** Global search for the ⌘K command palette. */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const canFinance =
    hasFeature(ctx.organization.plan as PlanKey, "finance") && canAccessScreen(ctx, "finance");
  const results = await globalSearch(ctx.organizationId, q, {
    allowed: (screen) => canAccessScreen(ctx, screen),
    canFinance,
    viewer: { userId: ctx.userId, role: ctx.role },
  });
  return Response.json(results);
}
