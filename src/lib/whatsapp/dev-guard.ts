/**
 * Development guard for outgoing WhatsApp.
 *
 * Outside production the local `.env` usually points EVOLUTION_API_URL at the
 * real shared VPS, so a manual test sends for real: on 28/10/2026 made-up phones
 * in a test CSV added 18 strangers to a real group (docs/guia/07). This guard
 * fails closed: outside production a message only goes to a destination listed
 * in WHATSAPP_DEV_ALLOWED_NUMBERS, and an empty list sends nothing.
 *
 * Production (NODE_ENV=production, set by `next start` and by Passenger) is never
 * touched. A loopback EVOLUTION base URL is let through too: that is a local fake
 * Evolution (the e2e scripts), which reaches nobody.
 *
 * Pure (no env, no network) so `npm run check:devguard` can test it; the wiring
 * lives in src/lib/integrations/channels/evolution.ts, in
 * src/lib/integrations/evolution-client.ts (group add and invite) and, for the
 * official WhatsApp, in src/lib/whatsapp-cloud/meta-api.ts (postMessage).
 */
import { normalizeWhatsappNumber } from "@/lib/phone";

/** Every form a destination may take: digits with the country code and, for a
 * Brazilian mobile, with and without the 9th digit (WhatsApp may use either).
 * A group JID is kept as is. A "@s.whatsapp.net"/"@lid" suffix is dropped. */
export function destinationKeys(raw: string): string[] {
  const value = (raw ?? "").trim();
  if (!value) return [];
  if (value.endsWith("@g.us")) return [value];
  const n = normalizeWhatsappNumber(value.replace(/@.*$/, ""));
  if (!n) return [];
  if (n.startsWith("55") && n.length === 13 && n[4] === "9") return [n, n.slice(0, 4) + n.slice(5)];
  if (n.startsWith("55") && n.length === 12) return [n, `${n.slice(0, 4)}9${n.slice(4)}`];
  return [n];
}

/** WHATSAPP_DEV_ALLOWED_NUMBERS (comma or semicolon separated; spaces inside an
 * entry are fine, as in "(11) 91234-5678") → the set of every accepted form of
 * each entry. Unset or empty → empty set. */
export function parseDevAllowlist(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(/[,;\n]+/)) {
    for (const key of destinationKeys(part)) out.add(key);
  }
  return out;
}

function isLoopback(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || /^127\./.test(host);
  } catch {
    return false;
  }
}

export type DevGuardInput = {
  nodeEnv: string | undefined;
  /** Evolution base URL the message would be posted to. */
  baseUrl: string;
  /** Number, group JID or remoteJid the message would reach. */
  target: string;
  allowed: ReadonlySet<string>;
};

/** True when the message must NOT go out. */
export function devGuardBlocks(input: DevGuardInput): boolean {
  if (input.nodeEnv === "production") return false;
  if (isLoopback(input.baseUrl)) return false;
  return !destinationKeys(input.target).some((key) => input.allowed.has(key));
}

/**
 * The same guard for the official WhatsApp (Cloud API): the body of a
 * POST /{phone-number-id}/messages. True when it must NOT go out.
 * - A phone in `to` must be on the list, like any Evolution send.
 * - A body with no destination (the read receipt, `status: "read"`) reaches
 *   nobody and passes.
 * - A destination by BSUID only (`recipient`, no phone) can't be matched against
 *   a list of numbers, so outside production it is held.
 * There is no loopback exception: the Graph API is always the real Meta.
 */
export function cloudSendBlocked(input: {
  nodeEnv: string | undefined;
  payload: Record<string, unknown>;
  allowed: ReadonlySet<string>;
}): boolean {
  if (input.nodeEnv === "production") return false;
  const to = input.payload.to;
  if (typeof to === "string" && to.trim()) {
    return !destinationKeys(to).some((key) => input.allowed.has(key));
  }
  return input.payload.recipient !== undefined && input.payload.recipient !== null;
}
