import "server-only";

/**
 * Minimal Gmail client for the mass e-mail's Google channel (send only). Never
 * throws: a network error or timeout comes back as status 0. Tokens are passed
 * in by the caller, only ever go in the Authorization header, and are never logged.
 */
const GMAIL_SEND_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send";

/** What `messages.send` answers on success. */
export type GmailMessage = { id?: string; threadId?: string; labelIds?: string[] };

export type GmailFailure = { ok: false; status: number; code: string | null; message: string; retryAfter: number | null };
export type GmailResult<T> = { ok: true; status: number; data: T; location: string | null } | GmailFailure;

/** FAILED_PRECONDITION -> failedPrecondition; any other shape is left as it is. */
function statusAsReason(status: string): string {
  if (!/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(status)) return status;
  return status.toLowerCase().replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export async function gmailCall<T>(
  url: string,
  init: {
    method: "POST" | "PUT";
    token: string;
    body?: Uint8Array | string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<GmailResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: { ...init.headers, Authorization: `Bearer ${init.token}` },
      // Uint8Array is a valid fetch body at runtime; TS lib types want ArrayBuffer-backed.
      body: init.body as BodyInit | undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
    const text = await res.text().catch(() => "");
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        // The literal `null`, a number, a string or an array parses fine but is not a plain object.
        const parsed: unknown = JSON.parse(text);
        json = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
      } catch {
        json = {};
      }
    }
    if (!res.ok) {
      // { error: { code, message, status, errors: [{ reason }] } }: the reason is the precise code.
      const err = (json.error && typeof json.error === "object" ? json.error : {}) as Record<string, unknown>;
      const first = Array.isArray(err.errors) ? (err.errors[0] as Record<string, unknown> | undefined) : undefined;
      const reason = first && typeof first.reason === "string" && first.reason ? first.reason : null;
      // Without errors[].reason, error.status is UPPER_SNAKE (FAILED_PRECONDITION): as camelCase it matches the reason rules.
      const statusReason = typeof err.status === "string" && err.status ? statusAsReason(err.status) : null;
      const retryAfter = Number(res.headers.get("retry-after"));
      return {
        ok: false,
        status: res.status,
        code: reason ?? statusReason,
        message: typeof err.message === "string" && err.message ? err.message : `Gmail ${res.status}`,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      };
    }
    return { ok: true, status: res.status, data: json as T, location: res.headers.get("location") };
  } catch (e) {
    return { ok: false, status: 0, code: null, message: e instanceof Error ? e.message : "network error", retryAfter: null };
  }
}

/** The whole RFC 822 message in one POST (up to 5 MB): the e-mail goes out and lands in Sent. */
export function gmailSendSimple(token: string, mime: Buffer) {
  return gmailCall<GmailMessage>(`${GMAIL_SEND_URL}?uploadType=media`, {
    method: "POST",
    token,
    body: mime,
    headers: { "Content-Type": "message/rfc822" },
    timeoutMs: 60_000,
  });
}

/** Opens a resumable upload for a message of `size` bytes; the session URL comes back in `location`. */
export function gmailStartResumable(token: string, size: number) {
  return gmailCall<Record<string, never>>(`${GMAIL_SEND_URL}?uploadType=resumable`, {
    method: "POST",
    token,
    body: "{}",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "message/rfc822",
      "X-Upload-Content-Length": String(size),
    },
    timeoutMs: 60_000,
  });
}

/** The message bytes in a single PUT to the session URL: this is the call that hands the e-mail over. */
export function gmailFinishResumable(token: string, location: string, mime: Buffer) {
  return gmailCall<GmailMessage>(location, {
    method: "PUT",
    token,
    body: mime,
    headers: { "Content-Type": "message/rfc822" },
    timeoutMs: 120_000,
  });
}
