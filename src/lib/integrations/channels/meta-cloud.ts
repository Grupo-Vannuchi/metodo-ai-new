import "server-only";
import type { ChannelAdapter } from "./types";
import { env } from "@/lib/env";
import { normalizeWhatsappNumber } from "@/lib/phone";
import { cloudSendBlocked, parseDevAllowlist } from "@/lib/whatsapp/dev-guard";

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
    const payload = {
      messaging_product: "whatsapp",
      to: normalizeWhatsappNumber(input.to),
      type: "text",
      text: { body: input.body },
    };
    // Trava de dev (regras em src/lib/whatsapp/dev-guard.ts), como no evolution.ts:
    // fora de produção, só sai para WHATSAPP_DEV_ALLOWED_NUMBERS.
    const allowed = parseDevAllowlist(env.WHATSAPP_DEV_ALLOWED_NUMBERS);
    if (cloudSendBlocked({ nodeEnv: env.NODE_ENV, payload, allowed })) {
      console.warn("[meta-cloud] dev guard held back a message (not in WHATSAPP_DEV_ALLOWED_NUMBERS)");
      return {
        ok: false,
        error: "Envio de WhatsApp bloqueado fora de produção: o número não está em WHATSAPP_DEV_ALLOWED_NUMBERS.",
      };
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
