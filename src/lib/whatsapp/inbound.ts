/**
 * Pure parser for Evolution `messages.upsert` webhook payloads → a flat list of
 * normalized inbound messages. No DB / server-only so it stays unit-testable.
 * Groups, broadcasts and status updates are skipped (individual chats only).
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

export type ParsedInbound = {
  remoteJid: string;
  fromMe: boolean;
  pushName: string | null;
  providerMessageId: string | null;
  type: InboundType;
  body: string | null;
  /** Short text for the conversation list. */
  preview: string;
  timestamp: Date;
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

function isIndividualChat(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net");
}

function parseOne(data: Json): ParsedInbound | null {
  const key = data.key as Json | undefined;
  const remoteJid = (key?.remoteJid as string | undefined)?.trim();
  if (!remoteJid || !isIndividualChat(remoteJid)) return null;

  const fromMe = Boolean(key?.fromMe);
  const providerMessageId = (key?.id as string | undefined) ?? null;
  const pushName = ((data.pushName as string | undefined) ?? "").trim() || null;

  const tsRaw = Number(data.messageTimestamp ?? 0);
  const timestamp = tsRaw > 0 ? new Date(tsRaw * 1000) : new Date();

  const message = (data.message as Json | undefined) ?? {};
  let type: InboundType = "UNKNOWN";
  let body: string | null = null;

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
        break;
      }
    }
  }

  const preview = body?.trim() || PREVIEW_FALLBACK[type] || "[mensagem]";
  return { remoteJid, fromMe, pushName, providerMessageId, type, body, preview, timestamp };
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
