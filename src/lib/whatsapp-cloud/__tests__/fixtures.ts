/**
 * Payloads de webhook no formato da referência da Meta (puro). Usados pelos
 * testes e pelo simulador scripts/wa-cloud-webhook.ts.
 */
export const PHONE_NUMBER_ID = "106540352242922";
export const WABA_ID = "102290129340398";

type Obj = Record<string, unknown>;

export function envelope(value: Obj, field = "messages", wabaId = WABA_ID): Obj {
  return { object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field, value }] }] };
}

function metadata(phoneNumberId: string): Obj {
  return { display_phone_number: "15550783881", phone_number_id: phoneNumberId };
}

export type WhoOpts = {
  phoneNumberId?: string;
  wamid?: string;
  /** Telefone do cliente; `null` simula cliente só com nome de usuário. */
  waId?: string | null;
  bsuid?: string | null;
  name?: string;
  username?: string;
  timestamp?: number;
  contextId?: string;
};

function sender(o: WhoOpts) {
  const waId = o.waId === undefined ? "5511999990001" : o.waId;
  const bsuid = o.bsuid === undefined ? "BR.1349120865530274191" : o.bsuid;
  const contact: Obj = { profile: { name: o.name ?? "Maria Cliente", ...(o.username ? { username: o.username } : {}) } };
  if (waId) contact.wa_id = waId;
  if (bsuid) contact.user_id = bsuid;
  const from: Obj = {};
  if (waId) from.from = waId;
  if (bsuid) from.from_user_id = bsuid;
  return { contact, from };
}

function messageValue(o: WhoOpts, typed: Obj): Obj {
  const { contact, from } = sender(o);
  return {
    messaging_product: "whatsapp",
    metadata: metadata(o.phoneNumberId ?? PHONE_NUMBER_ID),
    contacts: [contact],
    messages: [
      {
        ...from,
        id: o.wamid ?? "wamid.IN.0001",
        timestamp: String(o.timestamp ?? 1790000000),
        ...(o.contextId ? { context: { from: "15550783881", id: o.contextId } } : {}),
        ...typed,
      },
    ],
  };
}

export function inboundText(o: WhoOpts & { body?: string } = {}): Obj {
  return envelope(messageValue(o, { type: "text", text: { body: o.body ?? "Olá, quero um orçamento" } }));
}

export function inboundMedia(
  kind: "image" | "video" | "audio" | "document" | "sticker",
  o: WhoOpts & { caption?: string; filename?: string } = {},
): Obj {
  const mime = {
    image: "image/jpeg",
    video: "video/mp4",
    audio: "audio/ogg; codecs=opus",
    document: "application/pdf",
    sticker: "image/webp",
  }[kind];
  const media: Obj = { id: `media-${kind}-1`, mime_type: mime, sha256: "abc", url: "https://lookaside.fbsbx.com/x" };
  if (o.caption) media.caption = o.caption;
  if (kind === "document") media.filename = o.filename ?? "orcamento.pdf";
  if (kind === "audio") media.voice = true;
  return envelope(messageValue(o, { type: kind, [kind]: media }));
}

export function inboundLocation(o: WhoOpts & { name?: string; address?: string } = {}): Obj {
  const location: Obj = { latitude: -23.55, longitude: -46.63 };
  if (o.name) location.name = o.name;
  if (o.address) location.address = o.address;
  return envelope(messageValue(o, { type: "location", location }));
}

export function inboundReaction(o: WhoOpts & { targetWamid: string; emoji?: string | null }): Obj {
  const reaction: Obj = { message_id: o.targetWamid };
  if (o.emoji !== null) reaction.emoji = o.emoji ?? "👍";
  return envelope(messageValue(o, { type: "reaction", reaction }));
}

export function statusUpdate(o: {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed" | "played";
  phoneNumberId?: string;
  waId?: string | null;
  bsuid?: string | null;
  errorCode?: number;
  errorDetails?: string;
  pricingCategory?: string;
  timestamp?: number;
}): Obj {
  const s: Obj = { id: o.wamid, status: o.status, timestamp: String(o.timestamp ?? 1790000100) };
  const waId = o.waId === undefined ? "5511999990001" : o.waId;
  const bsuid = o.bsuid === undefined ? "BR.1349120865530274191" : o.bsuid;
  if (waId) s.recipient_id = waId;
  if (bsuid) s.recipient_user_id = bsuid;
  if (o.pricingCategory) s.pricing = { pricing_model: "PMP", type: "regular", category: o.pricingCategory };
  if (o.status === "failed") {
    s.errors = [
      {
        code: o.errorCode ?? 131026,
        title: "Message undeliverable",
        message: "Message undeliverable",
        error_data: { details: o.errorDetails ?? "O destinatário não pode receber esta mensagem." },
      },
    ];
  }
  return envelope({
    messaging_product: "whatsapp",
    metadata: metadata(o.phoneNumberId ?? PHONE_NUMBER_ID),
    statuses: [s],
  });
}

export function templateStatusUpdate(o: {
  name: string;
  event: string;
  language?: string;
  reason?: string;
  id?: number;
  wabaId?: string;
}): Obj {
  return envelope(
    {
      event: o.event,
      message_template_id: o.id ?? 594425479261596,
      message_template_name: o.name,
      message_template_language: o.language ?? "pt_BR",
      reason: o.reason ?? "NONE",
    },
    "message_template_status_update",
    o.wabaId ?? WABA_ID,
  );
}

export function userIdUpdate(o: { previous: string; current: string; waId?: string; phoneNumberId?: string }): Obj {
  return envelope({
    messaging_product: "whatsapp",
    metadata: metadata(o.phoneNumberId ?? PHONE_NUMBER_ID),
    user_id_update: [
      { wa_id: o.waId ?? "5511999990001", detail: "user changed number", user_id: { previous: o.previous, current: o.current }, timestamp: "1790000200" },
    ],
  });
}
