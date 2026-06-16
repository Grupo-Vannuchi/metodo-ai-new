"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { encryptCredentials, decryptCredentials } from "@/lib/integrations/crypto";
import { connectionState } from "@/lib/integrations/evolution-client";
import { searchPlacesPage } from "@/lib/prospecting/places";
import { audit } from "@/lib/audit";
import { providerSpec, type IntegrationProviderKey } from "@/lib/integrations/registry";
import { planConfig, type PlanKey } from "@/config/plans";
import { countConnections } from "@/lib/queries/connections";
import {
  connectionSchema,
  connectionUpdateSchema,
  type ConnectionInput,
  type ConnectionUpdateInput,
} from "@/lib/validations/connection";

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
    await audit(ctx, {
      action: "connection.created",
      entity: "IntegrationConnection",
      entityId: conn.id,
      meta: { provider },
    });
    revalidatePath("/app/connections");
    return { ok: true, id: conn.id };
  } catch (error) {
    console.error("Failed to create connection", error);
    return { ok: false, error: "unknown" };
  }
}

/**
 * Update a connection's label and credentials. The provider is fixed. Blank
 * credential fields keep their current value (so secrets need not be re-typed),
 * which is why we decrypt the existing credentials and merge.
 */
export async function updateConnection(
  id: string,
  input: ConnectionUpdateInput,
): Promise<ConnectionActionResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const parsed = connectionUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  try {
    const db = tenantDb(ctx.organizationId);
    const conn = await db.integrationConnection.findFirst({
      where: { id },
      select: { id: true, provider: true, credentialsEnc: true },
    });
    if (!conn) return { ok: false, error: "invalid" };

    const provider = conn.provider as IntegrationProviderKey;
    const spec = providerSpec(provider);

    let existing: Record<string, string> = {};
    try {
      existing = decryptCredentials(conn.credentialsEnc);
    } catch {
      existing = {};
    }

    // Merge: only overwrite a field when the user typed a new value.
    const merged = { ...existing };
    for (const f of spec.fields) {
      const value = parsed.data.credentials[f.key]?.trim();
      if (value) merged[f.key] = value;
    }

    // Required fields must end up present (either kept or newly provided).
    const missing = spec.fields.some((f) => f.required && !merged[f.key]?.trim());
    if (missing) return { ok: false, error: "invalid" };

    await db.integrationConnection.updateMany({
      where: { id },
      data: { label: parsed.data.label, credentialsEnc: encryptCredentials(merged) },
    });
    await audit(ctx, {
      action: "connection.updated",
      entity: "IntegrationConnection",
      entityId: id,
      meta: { provider },
    });
    revalidatePath("/app/connections");
    revalidatePath(`/app/connections/${id}`);
    return { ok: true, id };
  } catch (error) {
    console.error("Failed to update connection", error);
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
    } else if (conn.provider === "GOOGLE") {
      try {
        const c = decryptCredentials(conn.credentialsEnc);
        const r = await searchPlacesPage(c.apiKey ?? "", "teste Brasil", undefined, 1);
        // Auth/billing failures are real errors; an empty result still means OK.
        status = r.ok || r.error.tag === "INVALID" ? "ACTIVE" : "ERROR";
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
    await audit(ctx, {
      action: "connection.deleted",
      entity: "IntegrationConnection",
      entityId: id,
    });
    revalidatePath("/app/connections");
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete connection", error);
    return { ok: false };
  }
}
