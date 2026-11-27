import "server-only";
import { canAccessScreen } from "@/lib/access";
import { hasFeatureByModules, hasModule } from "@/config/modules";
import { PIE_FINANCE_MODELS, PIE_MODELS, type PieModel } from "@/lib/queries/dashboard";

/**
 * The pies this member may open: the dashboard offers exactly these and
 * `/api/dashboard/pie` refuses the rest, so the two can't drift. CRM pies need
 * the CRM module (the dashboard is the CRM view); the tasks and finance pies
 * also need their screen, like the tasks and finance pages, since a member
 * restricted by an access template must not read them through the chart.
 * Gating, not data access, so it lives here and not in lib/queries (guia 04).
 */
export function availablePieModels(ctx: { modules: string[]; allowedScreens: string[] }): PieModel[] {
  if (!hasModule(ctx.modules, "crm")) return [];
  return [
    ...PIE_MODELS.filter(
      (m) => m !== "tasks_by_priority" || (hasModule(ctx.modules, "tasks") && canAccessScreen(ctx, "tasks")),
    ),
    ...(hasFeatureByModules(ctx.modules, "finance") && canAccessScreen(ctx, "finance") ? PIE_FINANCE_MODELS : []),
  ];
}
