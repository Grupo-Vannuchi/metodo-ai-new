import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Tenant-scoped Prisma client (the isolation safety net — PLANO.md §5).
 *
 * Wraps the shared client in a query extension that, for CRM/business models,
 * automatically:
 *   - injects `organizationId` into `data` on create / createMany;
 *   - injects `organizationId` into `where` on list/bulk/aggregate ops.
 *
 * It does NOT auto-scope `findUnique` / `update` / `delete` / `upsert` (those
 * take a *unique* selector where injecting org is invalid). The DAL must use
 * `findFirst` + `updateMany` / `deleteMany` with an explicit `{ id }` filter for
 * by-id work so the extension can add the tenant constraint. This is a backstop,
 * not a replacement for the DAL passing `organizationId` — defence in depth.
 */
const TENANT_MODELS = new Set<string>([
  "Company",
  "Contact",
  "Pipeline",
  "Stage",
  "Opportunity",
  "IntegrationConnection",
  "WebhookEndpoint",
  "ExtractionJob",
  "ExtractedLead",
  "MessageTemplate",
  "Campaign",
  "CampaignRecipient",
]);

const WHERE_OPS = new Set<string>([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

export function tenantDb(organizationId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = args as any;

          if (operation === "create") {
            a.data = { ...a.data, organizationId };
          } else if (operation === "createMany") {
            a.data = Array.isArray(a.data)
              ? a.data.map((d: unknown) => ({
                  ...(d as Record<string, unknown>),
                  organizationId,
                }))
              : { ...a.data, organizationId };
          } else if (WHERE_OPS.has(operation)) {
            a.where = { ...a.where, organizationId };
          }

          return query(a);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
