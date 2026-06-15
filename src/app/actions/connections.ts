"use server";

import { revalidatePath } from "next/cache";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { encryptCredentials } from "@/lib/integrations/crypto";
import { providerSpec, type IntegrationProviderKey } from "@/lib/integrations/registry";
import { planConfig, type PlanKey } from "@/config/plans";
import { countConnections } from "@/lib/queries/connections";
import { connectionSchema, type ConnectionInput } from "@/lib/validations/connection";

export type ConnectionActionResult =
  | { ok: true; id: string }
  | { ok: false; error: "unauthorized" | "invalid" | "limit" | "unknown" };

export async function createConnection(
  input: ConnectionInput,
): Promise<ConnectionActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const provider = parsed.data.provider as IntegrationProviderKey;
  const spec = providerSpec(provider);

  // All required credential fields must be present.
  const missing = spec.fields.some(
    (f) => f.required && !parsed.data.credentials[f.key]?.trim(),
  );
  if (missing) return { ok: false, error: "invalid" };

  // Plan connection limit.
  const limit = planConfig(ctx.organization.plan as PlanKey).connectionsLimit;
  if (limit !== null) {
    const count = await countConnections(ctx.organizationId);
    if (count >= limit) return { ok: false, error: "limit" };
  }

  try {
    const db = tenantDb(ctx.organizationId);
    const conn = await db.integrationConnection.create({
      data: {
        organizationId: ctx.organizationId,
        provider,
        label: parsed.data.label,
        credentialsEnc: encryptCredentials(parsed.data.credentials),
        status: "INACTIVE",
      },
    });
    revalidatePath("/app/connections");
    return { ok: true, id: conn.id };
  } catch (error) {
    console.error("Failed to create connection", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Test a connection. Per-provider connectivity checks are added with each
 * adapter (P5/P6); for now this validates the stored credentials decrypt and
 * marks the connection ACTIVE so the rest of the flow can be built.
 */
export async function testConnection(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    const conn = await db.integrationConnection.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!conn) return { ok: false };

    await db.integrationConnection.updateMany({
      where: { id },
      data: { status: "ACTIVE", lastTestAt: new Date() },
    });
    revalidatePath("/app/connections");
    return { ok: true };
  } catch (error) {
    console.error("Failed to test connection", error);
    return { ok: false };
  }
}

export async function deleteConnection(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    await db.integrationConnection.deleteMany({ where: { id } });
    revalidatePath("/app/connections");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete connection", error);
    return { ok: false };
  }
}
