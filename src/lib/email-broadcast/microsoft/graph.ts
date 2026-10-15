import "server-only";
import type { MimeFile } from "./mime";
import { uploadRanges } from "./core";

/**
 * Minimal Microsoft Graph client for the mass e-mail's Microsoft channel.
 * Never throws: a network error or timeout comes back as status 0. Tokens are
 * passed in by the caller and never logged.
 */
const GRAPH = "https://graph.microsoft.com/v1.0";

export type GraphFailure = { ok: false; status: number; code: string | null; message: string; retryAfter: number | null };
export type GraphResult<T> = { ok: true; status: number; data: T; location: string | null } | GraphFailure;

export async function graphCall<T>(
  url: string,
  init: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    token?: string;
    body?: string | Uint8Array;
    contentType?: string;
    contentRange?: string;
    timeoutMs?: number;
  },
): Promise<GraphResult<T>> {
  try {
    const headers: Record<string, string> = {};
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.contentType) headers["Content-Type"] = init.contentType;
    if (init.contentRange) headers["Content-Range"] = init.contentRange;
    const res = await fetch(url, {
      method: init.method,
      headers,
      // Uint8Array is a valid fetch body at runtime; TS lib types want ArrayBuffer-backed.
      body: init.body as BodyInit | undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
    const text = await res.text().catch(() => "");
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = {};
      }
    }
    if (!res.ok) {
      const err = (json.error && typeof json.error === "object" ? json.error : {}) as Record<string, unknown>;
      const retryAfter = Number(res.headers.get("retry-after"));
      return {
        ok: false,
        status: res.status,
        code: typeof err.code === "string" ? err.code : null,
        message: typeof err.message === "string" ? err.message : `Graph ${res.status}`,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      };
    }
    return { ok: true, status: res.status, data: json as T, location: res.headers.get("location") };
  } catch (e) {
    return { ok: false, status: 0, code: null, message: e instanceof Error ? e.message : "network error", retryAfter: null };
  }
}

/** The connected mailbox's address and name (personal accounts may only have userPrincipalName). */
export async function graphMe(
  token: string,
): Promise<{ ok: true; email: string; displayName: string | null } | { ok: false; message: string }> {
  const r = await graphCall<{ mail?: string | null; userPrincipalName?: string | null; displayName?: string | null }>(
    `${GRAPH}/me?$select=mail,userPrincipalName,displayName`,
    { method: "GET", token },
  );
  if (!r.ok) return { ok: false, message: r.message };
  const email = (r.data.mail || r.data.userPrincipalName || "").trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, message: "no e-mail address on the account" };
  return { ok: true, email, displayName: r.data.displayName?.trim() || null };
}

export { GRAPH };

const msg = (id: string) => `${GRAPH}/me/messages/${encodeURIComponent(id)}`;

/** POST /me/sendMail with a base64 MIME body: 202, saved to Sent Items. */
export function graphSendMime(token: string, mimeBase64: string) {
  return graphCall<Record<string, never>>(`${GRAPH}/me/sendMail`, {
    method: "POST",
    token,
    body: mimeBase64,
    contentType: "text/plain",
    timeoutMs: 60_000,
  });
}

/** POST /me/messages with a base64 MIME body: creates a draft (needs Mail.ReadWrite). */
export function graphCreateMimeDraft(token: string, mimeBase64: string) {
  return graphCall<{ id?: string }>(`${GRAPH}/me/messages`, {
    method: "POST",
    token,
    body: mimeBase64,
    contentType: "text/plain",
    timeoutMs: 60_000,
  });
}

/** A file under 3 MB, in one POST. */
export function graphAddAttachment(token: string, messageId: string, file: MimeFile) {
  return graphCall<{ id?: string }>(`${msg(messageId)}/attachments`, {
    method: "POST",
    token,
    contentType: "application/json",
    body: JSON.stringify({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: file.filename,
      contentType: file.contentType,
      contentBytes: file.data.toString("base64"),
    }),
    timeoutMs: 60_000,
  });
}

/** A file from 3 MB on, through an upload session (chunks of UPLOAD_CHUNK_BYTES, in order). */
export async function graphUploadAttachment(token: string, messageId: string, file: MimeFile): Promise<GraphResult<unknown>> {
  const session = await graphCall<{ uploadUrl?: string }>(`${msg(messageId)}/attachments/createUploadSession`, {
    method: "POST",
    token,
    contentType: "application/json",
    body: JSON.stringify({
      AttachmentItem: { attachmentType: "file", name: file.filename, size: file.data.byteLength, contentType: file.contentType },
    }),
  });
  if (!session.ok) return session;
  const uploadUrl = session.data.uploadUrl;
  if (!uploadUrl) return { ok: false, status: 502, code: null, message: "upload session without url", retryAfter: null };
  let last: GraphResult<unknown> = session;
  for (const { start, end } of uploadRanges(file.data.byteLength)) {
    // Pre-authenticated URL: no Authorization header (Graph docs).
    last = await graphCall<unknown>(uploadUrl, {
      method: "PUT",
      body: file.data.subarray(start, end + 1),
      contentType: "application/octet-stream",
      contentRange: `bytes ${start}-${end}/${file.data.byteLength}`,
      timeoutMs: 120_000,
    });
    if (!last.ok) return last;
  }
  return last;
}

/** Send a prepared draft: 202, saved to Sent Items. Empty body = Content-Length 0. */
export function graphSendDraft(token: string, messageId: string) {
  return graphCall<Record<string, never>>(`${msg(messageId)}/send`, { method: "POST", token, body: "", timeoutMs: 60_000 });
}

export function graphDeleteMessage(token: string, messageId: string) {
  return graphCall<Record<string, never>>(msg(messageId), { method: "DELETE", token });
}
