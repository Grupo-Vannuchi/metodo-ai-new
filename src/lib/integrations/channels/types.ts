import type { ChannelKey } from "./meta";

/** Channel adapter contract — one method to send a single message. */
export type { ChannelKey };

export type ChannelCredentials = Record<string, string>;

export type SendInput = {
  /** Destination: phone (digits, country code) for WhatsApp, email for EMAIL. */
  to: string;
  body: string;
  /** EMAIL only. */
  subject?: string;
  /** EMAIL sender override (defaults to the connection's fromEmail). */
  from?: string;
};

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

/** Outbound media (WhatsApp). `media` is a publicly-fetchable URL. */
export type SendMediaInput = {
  to: string;
  mediatype: "image" | "video" | "document" | "audio";
  media: string;
  mimetype?: string;
  caption?: string;
  fileName?: string;
};

/** React to a message with an emoji (empty string removes the reaction). */
export type SendReactionInput = {
  remoteJid: string;
  fromMe: boolean;
  /** Provider message id (Baileys key.id) of the target message. */
  messageId: string;
  emoji: string;
};

export interface ChannelAdapter {
  send(creds: ChannelCredentials, input: SendInput): Promise<SendResult>;
  /** Send an image/video/document/audio. Only channels that support it
   * (WhatsApp Evolution) implement this. */
  sendMedia?(creds: ChannelCredentials, input: SendMediaInput): Promise<SendResult>;
  /** React to a message with an emoji. WhatsApp Evolution only. */
  sendReaction?(creds: ChannelCredentials, input: SendReactionInput): Promise<SendResult>;
}
