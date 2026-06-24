import "server-only";

/**
 * Thin REST client for the Evolution API (v2) instance lifecycle. Endpoints and
 * payloads follow the official docs; responses are parsed defensively because
 * minor shapes vary across versions. The global `apiKey` (the server's
 * AUTHENTICATION_API_KEY) is sent in the `apikey` header for every call.
 *
 * See https://doc.evolution-api.com — instance, connect, connectionState, webhook.
 */
export type EvoCreds = { baseUrl: string; apiKey: string; instance: string };

export type EvoState = "open" | "connecting" | "close" | "unknown";

/** Events we subscribe the instance to (delivery-status mapping lands later). */
export const EVO_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
  "SEND_MESSAGE",
];

function base(creds: EvoCreds): string {
  return creds.baseUrl.replace(/\/$/, "");
}

function headers(creds: EvoCreds): HeadersInit {
  return { apikey: creds.apiKey, "Content-Type": "application/json" };
}

type Json = Record<string, unknown>;

async function req(
  creds: EvoCreds,
  method: string,
  path: string,
  body?: Json,
  timeoutMs?: number,
): Promise<{ ok: boolean; status: number; data: Json }> {
  try {
    const res = await fetch(`${base(creds)}${path}`, {
      method,
      headers: headers(creds),
      body: body ? JSON.stringify(body) : undefined,
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Json;
    return { ok: res.ok, status: res.status, data };
  } catch {
    // Network error / timeout — surface as a non-ok result instead of throwing.
    return { ok: false, status: 0, data: {} };
  }
}

/** Pull a QR-code base64 string out of the various shapes Evolution may return. */
function extractQr(data: Json): string | undefined {
  const qrcode = data.qrcode as Json | undefined;
  const b64 =
    (qrcode?.base64 as string | undefined) ?? (data.base64 as string | undefined);
  if (!b64) return undefined;
  return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
}

function errorOf(data: Json, status: number): string {
  const msg = data.message ?? data.error ?? data.response;
  if (typeof msg === "string") return msg;
  return `Evolution ${status}`;
}

export type ConnectResult = {
  ok: boolean;
  qrBase64?: string;
  pairingCode?: string;
  error?: string;
};

/** Create the instance (idempotent-ish: "already exists" is treated as ok). */
export async function createInstance(
  creds: EvoCreds,
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, status, data } = await req(creds, "POST", "/instance/create", {
    instanceName: creds.instance,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    webhook: { url: webhookUrl, enabled: true, events: EVO_EVENTS },
  });
  if (ok) return { ok: true };
  // Already exists → fine, we'll just connect.
  const msg = errorOf(data, status).toLowerCase();
  if (status === 403 || status === 409 || msg.includes("already")) {
    return { ok: true };
  }
  return { ok: false, error: errorOf(data, status) };
}

/** Fetch the QR code / pairing code to link the WhatsApp account. */
export async function connect(creds: EvoCreds): Promise<ConnectResult> {
  const { ok, status, data } = await req(
    creds,
    "GET",
    `/instance/connect/${encodeURIComponent(creds.instance)}`,
  );
  if (!ok) return { ok: false, error: errorOf(data, status) };
  return {
    ok: true,
    qrBase64: extractQr(data),
    pairingCode: (data.pairingCode as string | undefined) ?? undefined,
  };
}

export async function connectionState(
  creds: EvoCreds,
): Promise<{ ok: boolean; state: EvoState; error?: string }> {
  const { ok, status, data } = await req(
    creds,
    "GET",
    `/instance/connectionState/${encodeURIComponent(creds.instance)}`,
  );
  if (!ok) return { ok: false, state: "unknown", error: errorOf(data, status) };
  const instance = data.instance as Json | undefined;
  const raw = (instance?.state ?? data.state) as string | undefined;
  const state: EvoState =
    raw === "open" || raw === "connecting" || raw === "close" ? raw : "unknown";
  return { ok: true, state };
}

export async function setWebhook(
  creds: EvoCreds,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ok, status, data } = await req(
    creds,
    "POST",
    `/webhook/set/${encodeURIComponent(creds.instance)}`,
    {
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: false,
        events: EVO_EVENTS,
      },
    },
  );
  return ok ? { ok: true } : { ok: false, error: errorOf(data, status) };
}

export async function logout(creds: EvoCreds): Promise<{ ok: boolean }> {
  const { ok } = await req(
    creds,
    "DELETE",
    `/instance/logout/${encodeURIComponent(creds.instance)}`,
  );
  return { ok };
}

/** The Baileys message key needed to fetch (and decrypt) a media message. */
export type EvoMediaKey = { id: string; remoteJid: string; fromMe: boolean };

/**
 * Fetch and decrypt the media bytes of a message. WhatsApp media is end-to-end
 * encrypted, so the only way to get usable bytes is through Evolution, which
 * decrypts and returns base64. Response shapes vary across versions, so we read
 * `base64`/`mimetype` defensively (also accepting a nested envelope).
 */
export async function getBase64FromMediaMessage(
  creds: EvoCreds,
  key: EvoMediaKey,
): Promise<{ base64: string; mimetype: string } | null> {
  const { ok, data } = await req(
    creds,
    "POST",
    `/chat/getBase64FromMediaMessage/${encodeURIComponent(creds.instance)}`,
    { message: { key }, convertToMp4: false },
    25000,
  );
  if (!ok) return null;
  const envelope = (data.media as Json | undefined) ?? data;
  const base64 = envelope.base64 as string | undefined;
  const mimetype =
    (envelope.mimetype as string | undefined) ?? (envelope.mediaType as string | undefined);
  if (!base64 || !mimetype) return null;
  return { base64, mimetype };
}

/**
 * Fetch a contact's WhatsApp profile-picture URL (a pps.whatsapp.net link).
 * Returns null when the contact has no public photo or the call fails. The URL
 * is durable enough to store and refresh periodically.
 */
export async function fetchProfilePictureUrl(
  creds: EvoCreds,
  number: string,
): Promise<string | null> {
  const { ok, data } = await req(
    creds,
    "POST",
    `/chat/fetchProfilePictureUrl/${encodeURIComponent(creds.instance)}`,
    { number },
    15000,
  );
  if (!ok) return null;
  const url = (data.profilePictureUrl as string | undefined) ?? (data.url as string | undefined);
  return url && url.startsWith("http") ? url : null;
}
