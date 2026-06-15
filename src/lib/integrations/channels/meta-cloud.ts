import "server-only";
import type { ChannelAdapter } from "./types";

type MetaResponse = {
  messages?: { id?: string }[];
  error?: { message?: string };
};

/** WhatsApp Cloud API (Meta). Credentials: { phoneNumberId, accessToken }. */
const adapter: ChannelAdapter = {
  async send(creds, input) {
    if (!creds.phoneNumberId || !creds.accessToken) {
      return { ok: false, error: "Conexão Meta Cloud incompleta." };
    }
    const url = `https://graph.facebook.com/v20.0/${creds.phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "text",
          text: { body: input.body },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as MetaResponse;
      if (!res.ok) {
        return { ok: false, error: data.error?.message || `Meta ${res.status}` };
      }
      return { ok: true, providerMessageId: data.messages?.[0]?.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erro Meta Cloud" };
    }
  },
};

export default adapter;
