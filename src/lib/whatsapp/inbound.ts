/**
 * Pure parser for Evolution `messages.upsert` webhook payloads → a flat list of
 * normalized inbound messages. No DB / server-only so it stays unit-testable.
 * Individual chats and groups (`@g.us`) are kept; broadcasts and status updates
 * are skipped.
 */

export type InboundType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "STICKER"
  | "LOCATION"
  | "UNKNOWN";

/** Media metadata available from the webhook itself (no download needed). */
export type InboundMedia = {
  mime: string | null;
  name: string | null;
  size: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
};

export type ParsedInbound = {
  remoteJid: string;
  /** True when the chat is a WhatsApp group (`@g.us`). */
  isGroup: boolean;
  fromMe: boolean;
  pushName: string | null;
  /** Group sender's display name (groups only, inbound) — for "who said it". */
  senderName: string | null;
  providerMessageId: string | null;
  type: InboundType;
  body: string | null;
  /** Short text for the conversation list. */
  preview: string;
  timestamp: Date;
  /** Present for downloadable media types; null for text/location/unknown. */
  media: InboundMedia | null;
};

type Json = Record<string, unknown>;

const MEDIA: Record<string, InboundType> = {
  imageMessage: "IMAGE",
  audioMessage: "AUDIO",
  videoMessage: "VIDEO",
  documentMessage: "DOCUMENT",
  stickerMessage: "STICKER",
  locationMessage: "LOCATION",
};

/** Media types whose bytes we fetch + store (LOCATION carries coords, not bytes). */
const DOWNLOADABLE = new Set<InboundType>(["IMAGE", "AUDIO", "VIDEO", "DOCUMENT", "STICKER"]);

/** Coerce Baileys numeric fields (string | number | long-ish) to a finite int. */
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function extractMedia(node: Json): InboundMedia {
  return {
    mime: typeof node.mimetype === "string" ? node.mimetype : null,
    name: typeof node.fileName === "string" ? node.fileName : null,
    size: num(node.fileLength),
    durationSec: num(node.seconds),
    width: num(node.width),
    height: num(node.height),
  };
}

const PREVIEW_FALLBACK: Record<InboundType, string> = {
  TEXT: "",
  IMAGE: "[imagem]",
  AUDIO: "[áudio]",
  VIDEO: "[vídeo]",
  DOCUMENT: "[documento]",
  STICKER: "[figurinha]",
  LOCATION: "[localização]",
  UNKNOWN: "[mensagem]",
};

function parseOne(data: Json): ParsedInbound | null {
  const key = data.key as Json | undefined;
  const remoteJid = (key?.remoteJid as string | undefined)?.trim();
  if (!remoteJid) return null;
  const isGroup = remoteJid.endsWith("@g.us");
  const isIndividual = remoteJid.endsWith("@s.whatsapp.net");
  // Skip broadcasts / status / newsletters — only real chats and groups.
  if (!isGroup && !isIndividual) return null;

  const fromMe = Boolean(key?.fromMe);
  const providerMessageId = (key?.id as string | undefined) ?? null;
  const pushName = ((data.pushName as string | undefined) ?? "").trim() || null;
  // In groups `pushName` is the participant who sent the message.
  const senderName = isGroup && !fromMe ? pushName : null;

  const tsRaw = Number(data.messageTimestamp ?? 0);
  const timestamp = tsRaw > 0 ? new Date(tsRaw * 1000) : new Date();

  const message = (data.message as Json | undefined) ?? {};
  let type: InboundType = "UNKNOWN";
  let body: string | null = null;
  let media: InboundMedia | null = null;

  if (typeof message.conversation === "string") {
    type = "TEXT";
    body = message.conversation;
  } else if ((message.extendedTextMessage as Json | undefined)?.text) {
    type = "TEXT";
    body = String((message.extendedTextMessage as Json).text);
  } else {
    for (const [mediaKey, mediaType] of Object.entries(MEDIA)) {
      const node = message[mediaKey] as Json | undefined;
      if (node) {
        type = mediaType;
        body = typeof node.caption === "string" ? node.caption : null;
        if (DOWNLOADABLE.has(mediaType)) media = extractMedia(node);
        break;
      }
    }
  }

  const preview = body?.trim() || PREVIEW_FALLBACK[type] || "[mensagem]";
  return { remoteJid, isGroup, fromMe, pushName, senderName, providerMessageId, type, body, preview, timestamp, media };
}

/** Parse a webhook payload into inbound messages (handles single / array / Baileys shapes). */
export function parseInboundMessages(payload: Json): ParsedInbound[] {
  const data = payload.data;
  let rows: Json[] = [];
  if (Array.isArray(data)) {
    rows = data as Json[];
  } else if (data && typeof data === "object") {
    const inner = (data as Json).messages;
    rows = Array.isArray(inner) ? (inner as Json[]) : [data as Json];
  }
  return rows
    .map(parseOne)
    .filter((m): m is ParsedInbound => m !== null);
}
