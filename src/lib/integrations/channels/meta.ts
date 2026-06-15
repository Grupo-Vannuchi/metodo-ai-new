import type { Feature } from "@/config/plans";

/**
 * Client-safe channel metadata. Used by the campaign/template forms (labels,
 * gating, target field) and by the dispatcher (which connection to resolve).
 */
export type ChannelKey = "WHATSAPP_EVOLUTION" | "WHATSAPP_CLOUD" | "EMAIL";

export type ChannelMeta = {
  label: string;
  /** Which contact field is the destination. */
  target: "phone" | "email";
  /** Connection provider whose credentials this channel uses. */
  connectionProvider: "EVOLUTION" | "META_CLOUD" | "RESEND";
  feature: Feature;
  needsSubject: boolean;
};

export const CHANNEL_META: Record<ChannelKey, ChannelMeta> = {
  EMAIL: {
    label: "E-mail",
    target: "email",
    connectionProvider: "RESEND",
    feature: "campaigns.email",
    needsSubject: true,
  },
  WHATSAPP_EVOLUTION: {
    label: "WhatsApp (Evolution)",
    target: "phone",
    connectionProvider: "EVOLUTION",
    feature: "campaigns.whatsapp",
    needsSubject: false,
  },
  WHATSAPP_CLOUD: {
    label: "WhatsApp (Meta Cloud)",
    target: "phone",
    connectionProvider: "META_CLOUD",
    feature: "campaigns.whatsapp",
    needsSubject: false,
  },
};

export const CHANNEL_KEYS = Object.keys(CHANNEL_META) as ChannelKey[];
