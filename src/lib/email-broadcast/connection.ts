import "server-only";
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { createWebhook, deleteWebhook } from "./resend";
import { RESEND_WEBHOOK_EVENTS } from "./webhook";

/**
 * The client's own Resend account (Conexões → RESEND, fields apiKey +
 * fromEmail). The mass e-mail never falls back to the platform key.
 *
 * Raw Prisma with an explicit organizationId: this runs from the dispatcher
 * and the webhook (system context) as well as from actions, which pass
 * ctx.organizationId — every query filters by it.
 */

export type ResendConnection = {
  id: string;
  organizationId: string;
  apiKey: string;
  fromEmail: string;
  meta: Record<string, unknown>;
};

/** What we keep in IntegrationConnection.meta.emailWebhook. */
type EmailWebhookMeta = { id: string; secretEnc: string; keyHash: string; endpoint: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Short fingerprint of the API key: a changed key means re-registering. */
function keyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function readWebhookMeta(meta: unknown): EmailWebhookMeta | null {
  const w = asRecord(asRecord(meta).emailWebhook);
  const { id, secretEnc, keyHash: kh, endpoint } = w;
  return typeof id === "string" && typeof secretEnc === "string" && typeof kh === "string" && typeof endpoint === "string"
    ? { id, secretEnc, keyHash: kh, endpoint }
    : null;
}

/** The org's newest RESEND connection with usable credentials, or null. */
export async function getResendConnection(organizationId: string): Promise<ResendConnection | null> {
  const conn = await prisma.integrationConnection.findFirst({
    where: { organizationId, provider: "RESEND" },
    orderBy: { createdAt: "desc" },
    select: { id: true, organizationId: true, credentialsEnc: true, meta: true },
  });
  if (!conn) return null;
  try {
    const creds = decryptCredentials(conn.credentialsEnc);
    const apiKey = creds.apiKey?.trim();
    const fromEmail = creds.fromEmail?.trim();
    if (!apiKey || !fromEmail) return null;
    return { id: conn.id, organizationId: conn.organizationId, apiKey, fromEmail, meta: asRecord(conn.meta) };
  } catch {
    return null;
  }
}

/** Public URL Resend posts to, or null when the site can't receive webhooks
 * (http / localhost in dev — use an ngrok NEXT_PUBLIC_SITE_URL to test). */
export function webhookEndpoint(connectionId: string): string | null {
  let url: URL;
  try {
    url = new URL(env.NEXT_PUBLIC_SITE_URL);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  return `${url.origin}/api/webhooks/resend/${connectionId}`;
}

/** True when the stored webhook matches the current key and endpoint. */
export function deliveryTrackingActive(conn: ResendConnection): boolean {
  const w = readWebhookMeta(conn.meta);
  return Boolean(w && w.keyHash === keyHash(conn.apiKey) && w.endpoint === webhookEndpoint(conn.id));
}

/** The Svix signing secret stored for a connection, decrypted. */
export function webhookSecret(meta: unknown): string | null {
  const w = readWebhookMeta(meta);
  if (!w) return null;
  try {
    return decryptCredentials(w.secretEnc).secret ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort: make the client's Resend account post delivery events to us.
 * Returns false (and sending still works, statuses just stop at SENT) when the
 * site has no public https URL or the key can't manage webhooks.
 */
export async function ensureResendWebhook(conn: ResendConnection): Promise<boolean> {
  if (deliveryTrackingActive(conn)) return true;
  const endpoint = webhookEndpoint(conn.id);
  if (!endpoint) return false;

  const created = await createWebhook(conn.apiKey, endpoint, RESEND_WEBHOOK_EVENTS);
  if (!created.ok || !created.data.id || !created.data.signing_secret) {
    console.warn("[email] Resend webhook not registered:", created.ok ? "response without id/secret" : created.message);
    return false;
  }

  const previous = readWebhookMeta(conn.meta);
  if (previous && previous.id !== created.data.id) {
    await deleteWebhook(conn.apiKey, previous.id); // best-effort; another account's id just 404s
  }

  const emailWebhook: EmailWebhookMeta = {
    id: created.data.id,
    secretEnc: encryptCredentials({ secret: created.data.signing_secret }),
    keyHash: keyHash(conn.apiKey),
    endpoint,
  };
  const meta = { ...conn.meta, emailWebhook };
  await prisma.integrationConnection.updateMany({
    where: { id: conn.id, organizationId: conn.organizationId },
    data: { meta: meta as Prisma.InputJsonValue },
  });
  conn.meta = meta;
  return true;
}
