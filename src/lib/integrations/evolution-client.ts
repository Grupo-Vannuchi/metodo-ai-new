import "server-only";
import {
  existsOnWhatsapp,
  inviteUrlFrom,
  ownerJidFrom,
  parseGroupList,
  parseGroupParticipants,
  participantUpdateCode,
  type EvoGroupSummary,
  type GroupParticipant,
} from "./evolution-groups";

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

/** Events we subscribe the instance to (delivery-status mapping lands later).
 *  MESSAGES_SET carries the history batch synced right after the QR is scanned. */
export const EVO_EVENTS = [
  "MESSAGES_SET",
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
    // Pull the chat history on link so the inbox isn't empty until new messages
    // arrive (Baileys only pushes new messages otherwise). Delivered via
    // MESSAGES_SET. Only honored on a FRESH instance — hence delete-on-disconnect.
    syncFullHistory: true,
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

/**
 * Delete the instance entirely. `logout` alone unlinks the device but leaves the
 * instance (with its persisted auth) around, so Baileys can silently reconnect —
 * deleting clears that so a disconnect actually stays disconnected. The next
 * connect re-creates the instance (fresh, with the current webhook + history sync).
 */
export async function deleteInstance(creds: EvoCreds): Promise<{ ok: boolean }> {
  const { ok } = await req(
    creds,
    "DELETE",
    `/instance/delete/${encodeURIComponent(creds.instance)}`,
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

/** A WhatsApp group's subject, picture and participants. */
export type EvoGroupInfo = {
  subject: string | null;
  pictureUrl: string | null;
  participants: GroupParticipant[];
};

/**
 * Fetch a group's metadata (subject + participants) by its JID. Used to name
 * group conversations and to export the member list. Returns null on failure.
 */
export async function findGroupInfo(
  creds: EvoCreds,
  groupJid: string,
): Promise<EvoGroupInfo | null> {
  const { ok, data } = await req(
    creds,
    "GET",
    `/group/findGroupInfos/${encodeURIComponent(creds.instance)}?groupJid=${encodeURIComponent(groupJid)}`,
    undefined,
    20000,
  );
  if (!ok) return null;
  // Some versions wrap the group in an array or a `groupInfo`/`group` envelope.
  const g = (Array.isArray(data) ? (data as Json[])[0] : (data.group ?? data.groupInfo ?? data)) as Json;
  if (!g || typeof g !== "object") return null;

  const subject = typeof g.subject === "string" ? g.subject.trim() || null : null;
  const pictureUrl =
    typeof g.pictureUrl === "string" && g.pictureUrl.startsWith("http") ? g.pictureUrl : null;
  const participants = parseGroupParticipants(Array.isArray(g.participants) ? g.participants : []);

  return { subject, pictureUrl, participants };
}

/*
 * The calls of "Adicionar a grupo do WhatsApp". Reads, and the only two writes the feature may make: add one
 * participant to a group, and send a text message. Nothing else about a group or its members is touched.
 * None of them logs: a number or a text must not reach a log, and Evolution's own errors repeat both, so the
 * caller records what happened against the item it was working on.
 */

/**
 * Every group the linked number is in, with the participants of each. Null when the call fails or the answer is
 * not a list of groups; an empty list is a real answer (the number is in none).
 */
export async function fetchAllGroups(creds: EvoCreds): Promise<EvoGroupSummary[] | null> {
  const { ok, data } = await req(
    creds,
    "GET",
    `/group/fetchAllGroups/${encodeURIComponent(creds.instance)}?getParticipants=true`,
    undefined,
    30000,
  );
  if (!ok) return null;
  // The list is an array (cast to Json by `req`) or `{ groups }`. Anything else, an empty body included, is not a list.
  if (!Array.isArray(data) && !Array.isArray(data.groups)) return null;
  return parseGroupList(data);
}

/** One group by its JID, with its participants: what `findGroupInfo` reads, in the shape of the group list. Null on failure. */
export async function fetchGroupSummary(creds: EvoCreds, groupJid: string): Promise<EvoGroupSummary | null> {
  const { ok, data } = await req(
    creds,
    "GET",
    `/group/findGroupInfos/${encodeURIComponent(creds.instance)}?groupJid=${encodeURIComponent(groupJid)}`,
    undefined,
    20000,
  );
  if (!ok) return null;
  // The envelopes findGroupInfo accepts: the group alone, in an array, or under `group` / `groupInfo`.
  const g: unknown = Array.isArray(data) ? data[0] : (data.group ?? data.groupInfo ?? data);
  return parseGroupList([g])[0] ?? null;
}

/** The JID of the number this instance is linked to (the `ownerJid` of fetchInstances). Null when it has none or the call fails. */
export async function fetchOwnerJid(creds: EvoCreds): Promise<string | null> {
  const { ok, data } = await req(
    creds,
    "GET",
    `/instance/fetchInstances?instanceName=${encodeURIComponent(creds.instance)}`,
    undefined,
    15000,
  );
  return ok ? ownerJidFrom(data, creds.instance) : null;
}

/**
 * Adds one number to a group. `httpStatus` is Evolution's, 0 when no answer came (the add may or may not have
 * happened). `code` is the status Baileys gave that number ("200" added, "403" the person's privacy settings ask for
 * the link instead), null when the answer has none.
 */
export async function addGroupParticipant(
  creds: EvoCreds,
  groupJid: string,
  number: string,
): Promise<{ httpStatus: number; code: string | null }> {
  const { status, data } = await req(
    creds,
    "POST",
    `/group/updateParticipant/${encodeURIComponent(creds.instance)}?groupJid=${encodeURIComponent(groupJid)}`,
    { action: "add", participants: [number] },
    30000,
  );
  return { httpStatus: status, code: participantUpdateCode(data) };
}

/** Whether the number has a WhatsApp account. Null when Evolution doesn't say: the call failed, or it gave no answer for the number. */
export async function checkOnWhatsapp(creds: EvoCreds, number: string): Promise<boolean | null> {
  const { ok, data } = await req(
    creds,
    "POST",
    `/chat/whatsappNumbers/${encodeURIComponent(creds.instance)}`,
    { numbers: [number] },
    15000,
  );
  return ok ? existsOnWhatsapp(data) : null;
}

/** The group's invite link (https://chat.whatsapp.com/…). Null when the call fails or what comes back is not such a link. */
export async function fetchGroupInviteUrl(creds: EvoCreds, groupJid: string): Promise<string | null> {
  const { ok, data } = await req(
    creds,
    "GET",
    `/group/inviteCode/${encodeURIComponent(creds.instance)}?groupJid=${encodeURIComponent(groupJid)}`,
    undefined,
    15000,
  );
  return ok ? inviteUrlFrom(data) : null;
}

/**
 * Sends a text message. Unlike the channel adapter, it keeps the number and the text out of everything it could
 * write: it logs nothing, and returns only the HTTP status (0 when no answer came: the text may have gone out).
 */
export async function sendPlainText(
  creds: EvoCreds,
  number: string,
  text: string,
): Promise<{ ok: boolean; httpStatus: number }> {
  const { ok, status } = await req(
    creds,
    "POST",
    `/message/sendText/${encodeURIComponent(creds.instance)}`,
    { number, text },
    30000,
  );
  return { ok, httpStatus: status };
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
