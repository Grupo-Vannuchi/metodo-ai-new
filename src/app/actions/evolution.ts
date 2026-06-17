"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getOrgContext } from "@/lib/tenant";
import { tenantDb } from "@/lib/tenant-db";
import { decryptCredentials } from "@/lib/integrations/crypto";
import {
  createInstance,
  connect,
  connectionState,
  setWebhook,
  logout,
  type EvoCreds,
  type EvoState,
} from "@/lib/integrations/evolution-client";
import { env } from "@/lib/env";

function webhookUrl(connectionId: string, token: string): string {
  return `${env.NEXT_PUBLIC_SITE_URL}/api/webhooks/evolution/${connectionId}/${token}`;
}

/**
 * Ensure the connection has a stable per-connection webhook token (stored in
 * `meta.webhookToken`) so the inbound webhook can authenticate and resolve the
 * tenant. Returns the token.
 */
async function ensureWebhookToken(connectionId: string): Promise<string> {
  const conn = await prisma.integrationConnection.findUnique({
    where: { id: connectionId },
    select: { meta: true },
  });
  const existing = (conn?.meta as { webhookToken?: string } | null)?.webhookToken;
  if (existing) return existing;

  const token = randomBytes(24).toString("hex");
  const meta = { ...((conn?.meta as Record<string, unknown> | null) ?? {}), webhookToken: token };
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: { meta },
  });
  return token;
}

/** Load + decrypt an EVOLUTION connection's credentials, scoped to the org. */
async function loadEvoCreds(
  organizationId: string,
  id: string,
): Promise<EvoCreds | null> {
  const db = tenantDb(organizationId);
  const conn = await db.integrationConnection.findFirst({
    where: { id, provider: "EVOLUTION" },
    select: { credentialsEnc: true },
  });
  if (!conn) return null;
  try {
    const c = decryptCredentials(conn.credentialsEnc);
    if (!c.baseUrl || !c.apiKey || !c.instance) return null;
    return { baseUrl: c.baseUrl, apiKey: c.apiKey, instance: c.instance };
  } catch {
    return null;
  }
}

export type EvolutionConnectResult = {
  ok: boolean;
  qrBase64?: string;
  pairingCode?: string;
  error?: string;
};

/** Create the instance (if needed), wire the webhook and return a QR to scan. */
export async function connectEvolution(
  id: string,
): Promise<EvolutionConnectResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const creds = await loadEvoCreds(ctx.organizationId, id);
  if (!creds) return { ok: false, error: "not_found" };

  const token = await ensureWebhookToken(id);
  const url = webhookUrl(id, token);

  const created = await createInstance(creds, url);
  if (!created.ok) return { ok: false, error: created.error };

  // Best-effort (re)set of the webhook; ignore failures here.
  await setWebhook(creds, url);

  const result = await connect(creds);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/app/connections/${id}`);
  return { ok: true, qrBase64: result.qrBase64, pairingCode: result.pairingCode };
}

export type EvolutionStatusResult = { ok: boolean; state: EvoState };

/** Poll the connection state; mark the connection ACTIVE once it's open. */
export async function evolutionStatus(id: string): Promise<EvolutionStatusResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, state: "unknown" };

  const creds = await loadEvoCreds(ctx.organizationId, id);
  if (!creds) return { ok: false, state: "unknown" };

  const { ok, state } = await connectionState(creds);
  if (!ok) return { ok: false, state: "unknown" };

  const db = tenantDb(ctx.organizationId);
  await db.integrationConnection.updateMany({
    where: { id },
    data: {
      status: state === "open" ? "ACTIVE" : "INACTIVE",
      lastTestAt: new Date(),
    },
  });
  if (state === "open") revalidatePath(`/app/connections/${id}`);
  return { ok: true, state };
}

export async function disconnectEvolution(id: string): Promise<{ ok: boolean }> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false };

  const creds = await loadEvoCreds(ctx.organizationId, id);
  if (!creds) return { ok: false };

  await logout(creds);
  const db = tenantDb(ctx.organizationId);
  await db.integrationConnection.updateMany({
    where: { id },
    data: { status: "INACTIVE" },
  });
  revalidatePath(`/app/connections/${id}`);
  return { ok: true };
}
