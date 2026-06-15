"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { encryptCredentials, decryptCredentials } from "@/lib/integrations/crypto";
import { connectionState } from "@/lib/integrations/evolution-client";
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

  // Evolution: auto-generate an instance name when the user leaves it blank.
  const credentials = { ...parsed.data.credentials };
  if (provider === "EVOLUTION" && !credentials.instance?.trim()) {
    credentials.instance = `metodoai-${ctx.organization.slug}-${randomBytes(3).toString("hex")}`;
  }

  try {
    const db = tenantDb(ctx.organizationId);
    const conn = await db.integrationConnection.create({
      data: {
        organizationId: ctx.organizationId,
        provider,
        label: parsed.data.label,
        credentialsEnc: encryptCredentials(credentials),
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
 * Test a connection. For EVOLUTION it queries the real `connectionState`
 * (ACTIVE only when the WhatsApp session is open); other providers validate that
 * the stored credentials decrypt and are marked ACTIVE.
 */
export async function testConnection(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  try {
    const db = tenantDb(ctx.organizationId);
    const conn = await db.integrationConnection.findFirst({
      where: { id },
      select: { id: true, provider: true, credentialsEnc: true },
    });
    if (!conn) return { ok: false };

    let status: "ACTIVE" | "INACTIVE" | "ERROR" = "ACTIVE";
    if (conn.provider === "EVOLUTION") {
      try {
        const c = decryptCredentials(conn.credentialsEnc);
        const r = await connectionState({
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          instance: c.instance,
        });
        status = r.ok && r.state === "open" ? "ACTIVE" : "INACTIVE";
      } catch {
        status = "ERROR";
      }
    }

    await db.integrationConnection.updateMany({
      where: { id },
      data: { status, lastTestAt: new Date() },
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
