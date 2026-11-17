/**
 * Corpo JSON de cada envio para POST /{phone-number-id}/messages (puro).
 * Destino: telefone em `to`; sem telefone (cliente só com nome de usuário), o
 * BSUID vai em `recipient` — aceito pela Meta desde jul/2026.
 */
import type { SendComponent } from "./template-params";
import type { OutboundKind } from "./media-rules";

export type Recipient = { waId: string | null; bsuid: string | null };
type Payload = Record<string, unknown>;

export function recipientFields(r: Recipient): { to: string } | { recipient: string } {
  if (r.waId) return { to: r.waId };
  if (r.bsuid) return { recipient: r.bsuid };
  throw new Error("Conversa sem destinatário (nem telefone nem BSUID).");
}

function base(r: Recipient): Payload {
  return { messaging_product: "whatsapp", recipient_type: "individual", ...recipientFields(r) };
}

function context(quotedWamid?: string | null): Payload {
  return quotedWamid ? { context: { message_id: quotedWamid } } : {};
}

export function textPayload(r: Recipient, body: string, quotedWamid?: string | null): Payload {
  return { ...base(r), type: "text", text: { preview_url: false, body }, ...context(quotedWamid) };
}

export function mediaPayload(
  r: Recipient,
  kind: OutboundKind,
  mediaId: string,
  opts: { caption?: string | null; filename?: string | null; quotedWamid?: string | null } = {},
): Payload {
  const media: Payload = { id: mediaId };
  if (opts.caption && kind !== "audio") media.caption = opts.caption.slice(0, 1024);
  if (kind === "document" && opts.filename) media.filename = opts.filename;
  return { ...base(r), type: kind, [kind]: media, ...context(opts.quotedWamid) };
}

export function reactionPayload(r: Recipient, targetWamid: string, emoji: string): Payload {
  return { ...base(r), type: "reaction", reaction: { message_id: targetWamid, emoji } };
}

export function templatePayload(
  r: Recipient,
  name: string,
  language: string,
  components: SendComponent[],
): Payload {
  return {
    ...base(r),
    type: "template",
    template: { name, language: { code: language }, ...(components.length > 0 ? { components } : {}) },
  };
}

export function readPayload(wamid: string): Payload {
  return { messaging_product: "whatsapp", status: "read", message_id: wamid };
}
