import type { NextRequest } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { hasFeature, type PlanKey } from "@/config/plans";
import { dashboardPie, PIE_MODELS, PIE_FINANCE_MODELS, type PieModel } from "@/lib/queries/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL = [...PIE_MODELS, ...PIE_FINANCE_MODELS] as readonly string[];
const FINANCE = PIE_FINANCE_MODELS as readonly string[];

/** Pie-chart data for the dashboard. Returns raw keys ({ key, value }); the
 * client localizes them. Finance models require the finance feature. */
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const model = new URL(req.url).searchParams.get("model") ?? "";
  if (!ALL.includes(model)) return new Response("Bad request", { status: 400 });
  if (FINANCE.includes(model) && !hasFeature(ctx.organization.plan as PlanKey, "finance")) {
    return new Response("Forbidden", { status: 403 });
  }

  const slices = await dashboardPie(ctx.organizationId, model as PieModel);
  return Response.json(slices);
}
