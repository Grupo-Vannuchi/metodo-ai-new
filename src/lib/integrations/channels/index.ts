import "server-only";
import type { ChannelAdapter } from "./types";
import type { ChannelKey } from "./meta";
import email from "./email";
import evolution from "./evolution";
import metaCloud from "./meta-cloud";

export const CHANNEL_ADAPTERS: Record<ChannelKey, ChannelAdapter> = {
  EMAIL: email,
  WHATSAPP_EVOLUTION: evolution,
  WHATSAPP_CLOUD: metaCloud,
};

export function getChannelAdapter(channel: ChannelKey): ChannelAdapter {
  return CHANNEL_ADAPTERS[channel];
}
