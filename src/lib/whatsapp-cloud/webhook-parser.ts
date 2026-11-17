/**
 * Parser dos webhooks da WhatsApp Cloud API → eventos normalizados (puro — sem
 * banco nem `server-only`, coberto por __tests__/webhook-parser.test.ts).
 * Formato: developers.facebook.com/documentation/business-messaging/whatsapp/
 * webhooks/reference. O que não reconhece é pulado, nunca lança.
 *
 * Identidade do cliente: o BSUID (`user_id` / `from_user_id`) vem sempre desde
 * abr/2026; o telefone (`wa_id` / `from`) pode faltar para quem adotou nome de
 * usuário. Por isso os dois são opcionais e a gravação casa por qualquer um.
 */
type Json = Record<string, unknown>;

export type CloudInboundType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "STICKER"
  | "LOCATION"
  | "UNSUPPORTED";

export type CloudMediaRef = { id: string; mime: string | null; filename: string | null; voice: boolean };

export type CloudIdentity = { bsuid: string | null; waId: string | null };

export type CloudInboundMessage = CloudIdentity & {
  kind: "message";
  phoneNumberId: string;
  wamid: string;
  username: string | null;
  profileName: string | null;
  timestamp: Date;
  type: CloudInboundType;
  body: string | null;
  media: CloudMediaRef | null;
  quotedWamid: string | null;
  /** Extras por tipo: `location`, `referral` (anúncio), `rawType` (não suportado). */
  extra: Record<string, unknown>;
};

export type CloudInboundReaction = CloudIdentity & {
  kind: "reaction";
  phoneNumberId: string;
  targetWamid: string;
  /** "" = o cliente removeu a reação. */
  emoji: string;
  timestamp: Date;
};

export type CloudStatusUpdate = CloudIdentity & {
  kind: "status";
  phoneNumberId: string;
  wamid: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  timestamp: Date;
  errorCode: number | null;
  errorMessage: string | null;
  pricingCategory: string | null;
  pricingType: string | null;
};

export type CloudTemplateStatusUpdate = {
  kind: "template_status";
  wabaId: string;
  metaTemplateId: string;
  name: string;
  language: string;
  status: string;
  reason: string | null;
};

export type CloudUserIdUpdate = {
  kind: "user_id_update";
  phoneNumberId: string | null;
  waId: string | null;
  previousBsuid: string;
  currentBsuid: string;
};

export type CloudEvent =
  | CloudInboundMessage
  | CloudInboundReaction
  | CloudStatusUpdate
  | CloudTemplateStatusUpdate
  | CloudUserIdUpdate;

const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): Json[] =>
  Array.isArray(v) ? v.map(obj).filter((x): x is Json => x !== null) : [];
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function tsToDate(v: unknown): Date {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

const MEDIA_TYPES: Record<string, CloudInboundType> = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
  sticker: "STICKER",
};

const STATUS_MAP: Record<string, CloudStatusUpdate["status"]> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export function parseCloudWebhook(payload: unknown): CloudEvent[] {
  const root = obj(payload);
  if (!root || root.object !== "whatsapp_business_account") return [];
  const events: CloudEvent[] = [];
  for (const entry of arr(root.entry)) {
    const wabaId = str(entry.id) ?? "";
    for (const change of arr(entry.changes)) {
      const field = str(change.field);
      const value = obj(change.value);
      if (!value) continue;

      if (field === "message_template_status_update") {
        const t = parseTemplateStatus(wabaId, value);
        if (t) events.push(t);
        continue;
      }

      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      for (const u of arr(value.user_id_update)) {
        const e = parseUserIdUpdate(phoneNumberId, u);
        if (e) events.push(e);
      }
      if (field !== "messages" || !phoneNumberId) continue;

      const contacts = arr(value.contacts);
      for (const m of arr(value.messages)) {
        const e = parseMessage(phoneNumberId, m, contacts);
        if (e) events.push(e);
      }
      for (const s of arr(value.statuses)) {
        const e = parseStatus(phoneNumberId, s);
        if (e) events.push(e);
      }
    }
  }
  return events;
}

function findContact(contacts: Json[], m: Json): Json | null {
  const fromUser = str(m.from_user_id);
  const from = str(m.from);
  const match = contacts.find(
    (c) => (fromUser !== null && str(c.user_id) === fromUser) || (from !== null && str(c.wa_id) === from),
  );
  return match ?? (contacts.length === 1 ? contacts[0] : null);
}

function parseMessage(
  phoneNumberId: string,
  m: Json,
  contacts: Json[],
): CloudInboundMessage | CloudInboundReaction | null {
  const wamid = str(m.id);
  if (!wamid) return null;
  const contact = findContact(contacts, m);
  const profile = obj(contact?.profile);
  const bsuid = str(m.from_user_id) ?? str(contact?.user_id);
  const waId = str(m.from) ?? str(contact?.wa_id);
  if (!bsuid && !waId) return null;
  const timestamp = tsToDate(m.timestamp);
  const type = str(m.type) ?? "unknown";

  if (type === "reaction") {
    const r = obj(m.reaction);
    const target = str(r?.message_id);
    if (!target) return null;
    return { kind: "reaction", phoneNumberId, bsuid, waId, targetWamid: target, emoji: str(r?.emoji) ?? "", timestamp };
  }

  const extra: Record<string, unknown> = {};
  const referral = obj(m.referral);
  if (referral) extra.referral = referral;
  const base = {
    kind: "message" as const,
    phoneNumberId,
    wamid,
    bsuid,
    waId,
    username: str(profile?.username),
    profileName: str(profile?.name),
    timestamp,
    quotedWamid: str(obj(m.context)?.id),
  };

  if (type === "text") {
    return { ...base, type: "TEXT", body: str(obj(m.text)?.body), media: null, extra };
  }

  const mediaType = MEDIA_TYPES[type];
  if (mediaType) {
    const media = obj(m[type]);
    const id = str(media?.id);
    if (!id) return { ...base, type: "UNSUPPORTED", body: null, media: null, extra: { ...extra, rawType: type } };
    return {
      ...base,
      type: mediaType,
      body: str(media?.caption),
      media: { id, mime: str(media?.mime_type), filename: str(media?.filename), voice: media?.voice === true },
      extra,
    };
  }

  if (type === "location") {
    const loc = obj(m.location) ?? {};
    const name = str(loc.name);
    const address = str(loc.address);
    const label = [name, address].filter(Boolean).join(" — ");
    return {
      ...base,
      type: "LOCATION",
      body: label || `${loc.latitude},${loc.longitude}`,
      media: null,
      extra: { ...extra, location: { latitude: loc.latitude, longitude: loc.longitude, name, address } },
    };
  }

  if (type === "button") {
    return { ...base, type: "TEXT", body: str(obj(m.button)?.text), media: null, extra };
  }

  if (type === "interactive") {
    const i = obj(m.interactive);
    const title = str(obj(i?.button_reply)?.title) ?? str(obj(i?.list_reply)?.title);
    return { ...base, type: "TEXT", body: title, media: null, extra };
  }

  return { ...base, type: "UNSUPPORTED", body: null, media: null, extra: { ...extra, rawType: type } };
}

function parseStatus(phoneNumberId: string, s: Json): CloudStatusUpdate | null {
  const wamid = str(s.id);
  const status = STATUS_MAP[str(s.status) ?? ""];
  if (!wamid || !status) return null;
  const err = arr(s.errors)[0] as Json | undefined;
  const pricing = obj(s.pricing);
  return {
    kind: "status",
    phoneNumberId,
    wamid,
    status,
    timestamp: tsToDate(s.timestamp),
    bsuid: str(s.recipient_user_id),
    waId: str(s.recipient_id),
    errorCode: typeof err?.code === "number" ? err.code : null,
    errorMessage: err ? (str(obj(err.error_data)?.details) ?? str(err.message) ?? str(err.title)) : null,
    pricingCategory: str(pricing?.category),
    pricingType: str(pricing?.type),
  };
}

function parseTemplateStatus(wabaId: string, v: Json): CloudTemplateStatusUpdate | null {
  const name = str(v.message_template_name);
  const language = str(v.message_template_language);
  const status = str(v.event);
  if (!wabaId || !name || !language || !status) return null;
  const reason = str(v.reason);
  const id = v.message_template_id;
  return {
    kind: "template_status",
    wabaId,
    metaTemplateId: id === undefined || id === null ? "" : String(id),
    name,
    language,
    status,
    reason: reason && reason !== "NONE" ? reason : null,
  };
}

function parseUserIdUpdate(phoneNumberId: string | null, u: Json): CloudUserIdUpdate | null {
  const ids = obj(u.user_id);
  const previous = str(ids?.previous);
  const current = str(ids?.current);
  if (!previous || !current || previous === current) return null;
  return { kind: "user_id_update", phoneNumberId, waId: str(u.wa_id), previousBsuid: previous, currentBsuid: current };
}
