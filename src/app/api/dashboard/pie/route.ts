import type { NextRequest } from "next/server";
import { getOrgContext } from "@/lib/tenant";
import { dashboardPie, PIE_MODELS, PIE_FINANCE_MODELS, type PieModel } from "@/lib/queries/dashboard";
import { availablePieModels } from "@/lib/dashboard-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL = [...PIE_MODELS, ...PIE_FINANCE_MODELS] as readonly string[];

/** Pie-chart data for the dashboard. Returns raw keys ({ key, value }); the
 * client localizes them. Only the pies the dashboard offers this member
 * (`availablePieModels`: the CRM module and screen, plus the tasks or finance
 * screen for those pies). */
export async function GET(req: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const model = new URL(req.url).searchParams.get("model") ?? "";
  if (!ALL.includes(model)) return new Response("Bad request", { status: 400 });
  if (!availablePieModels(ctx).includes(model as PieModel)) {
    return new Response("Forbidden", { status: 403 });
  }

  const slices = await dashboardPie(ctx.organizationId, model as PieModel);
  return Response.json(slices);
}
