import "server-only";

/**
 * Minimal Resend REST client for the mass e-mail, always with the CLIENT's
 * key. Separate from src/lib/email/send.ts (platform transactional mail) and
 * from the Campaigns adapter (src/lib/integrations/channels/email.ts), both
 * untouched. Never throws: network errors come back as status 0.
 */

const API = "https://api.resend.com";

export type ResendEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
};

export type ResendCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; retryAfter: number | null };

async function call<T>(
  apiKey: string,
  path: string,
  init: { method: "POST" | "DELETE"; body?: unknown; idempotencyKey?: string },
): Promise<ResendCallResult<T>> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      return {
        ok: false,
        status: res.status,
        message: typeof json.message === "string" ? json.message : `Resend ${res.status}`,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "Falha de rede", retryAfter: null };
  }
}

/** Up to 100 e-mails; `data[i]` answers `emails[i]`. The key dedupes retries for 24h. */
export function sendBatch(apiKey: string, emails: ResendEmail[], idempotencyKey: string) {
  return call<{ data?: { id: string }[] }>(apiKey, "/emails/batch", {
    method: "POST",
    body: emails,
    idempotencyKey,
  });
}

export function sendOne(apiKey: string, email: ResendEmail, idempotencyKey?: string) {
  return call<{ id?: string }>(apiKey, "/emails", { method: "POST", body: email, idempotencyKey });
}

export function createWebhook(apiKey: string, endpoint: string, events: readonly string[]) {
  return call<{ id?: string; signing_secret?: string }>(apiKey, "/webhooks", {
    method: "POST",
    body: { endpoint, events },
  });
}

export function deleteWebhook(apiKey: string, id: string) {
  return call<unknown>(apiKey, `/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}
