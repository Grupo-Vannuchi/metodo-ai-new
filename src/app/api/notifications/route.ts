import { getOrgContext } from "@/lib/tenant";
import { getAlerts } from "@/lib/queries/notifications";
import { hasFeature, type PlanKey } from "@/config/plans";

export const runtime = "nodejs";

/** Derived alerts for the notification bell (polled by the client). */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const alerts = await getAlerts(
    ctx.organizationId,
    ctx.userId,
    hasFeature(ctx.organization.plan as PlanKey, "finance"),
  );
  return Response.json(alerts);
}
