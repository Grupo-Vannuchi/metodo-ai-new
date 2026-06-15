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

export interface ChannelAdapter {
  send(creds: ChannelCredentials, input: SendInput): Promise<SendResult>;
}
