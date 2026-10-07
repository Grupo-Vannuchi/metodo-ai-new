import { createHmac, timingSafeEqual } from "crypto";

/**
 * Pure side of the Resend delivery webhook: Svix signature check, payload
 * parsing and the forward-only status transitions. The route
 * (src/app/api/webhooks/resend/[connectionId]/route.ts) does the DB writes.
 */

export const RESEND_WEBHOOK_EVENTS = [
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
] as const;

export type ResendEventType = (typeof RESEND_WEBHOOK_EVENTS)[number];

export type RecipientStatusName = "QUEUED" | "SENT" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "FAILED";

export type ResendEvent = {
  type: ResendEventType;
  emailId: string;
  bouncePermanent: boolean;
  message: string | null;
};

function secretKey(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

/** "v1,<base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`>" — the Svix scheme Resend uses. */
export function signSvix(secret: string, id: string, timestamp: string, body: string): string {
  return "v1," + createHmac("sha256", secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
}

/**
 * Verify the `svix-*` headers against the raw body. The signature header may
 * carry several space-separated "v1,<sig>" entries (key rotation); any match
 * passes. Timestamps older/newer than the tolerance are rejected (replay).
 */
export function verifySvixSignature(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (input.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(signSvix(input.secret, id, timestamp, input.body));
  return signature.split(" ").some((candidate) => {
    const got = Buffer.from(candidate.trim());
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** The parts of a Resend event we act on, or null for anything else. */
export function parseResendEvent(payload: unknown): ResendEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    type?: unknown;
    data?: { email_id?: unknown; bounce?: { type?: unknown; message?: unknown }; failed?: { reason?: unknown } };
  };
  const type = String(p.type ?? "");
  if (!(RESEND_WEBHOOK_EVENTS as readonly string[]).includes(type)) return null;
  const emailId = typeof p.data?.email_id === "string" ? p.data.email_id : "";
  if (!emailId) return null;
  const bounceMessage = typeof p.data?.bounce?.message === "string" ? p.data.bounce.message : null;
  const failedReason = typeof p.data?.failed?.reason === "string" ? p.data.failed.reason : null;
  return {
    type: type as ResendEventType,
    emailId,
    bouncePermanent: p.data?.bounce?.type === "Permanent",
    message: bounceMessage ?? failedReason,
  };
}

/** Target status per event and the statuses it may move from (forward-only). */
export const TRANSITIONS: Record<ResendEventType, { to: RecipientStatusName; from: RecipientStatusName[] }> = {
  "email.delivered": { to: "DELIVERED", from: ["SENT"] },
  "email.bounced": { to: "BOUNCED", from: ["SENT", "DELIVERED"] },
  "email.complained": { to: "COMPLAINED", from: ["QUEUED", "SENT", "DELIVERED", "BOUNCED"] },
  "email.failed": { to: "FAILED", from: ["QUEUED", "SENT"] },
};

export function nextRecipientStatus(
  current: RecipientStatusName,
  type: ResendEventType,
): RecipientStatusName | null {
  const t = TRANSITIONS[type];
  return t.from.includes(current) ? t.to : null;
}

/** Only hard bounces and spam complaints block the address for future sends. */
export function suppressionFor(event: ResendEvent): "BOUNCED" | "COMPLAINED" | null {
  if (event.type === "email.complained") return "COMPLAINED";
  if (event.type === "email.bounced" && event.bouncePermanent) return "BOUNCED";
  return null;
}
