import "server-only";
import type { ChannelAdapter } from "./types";
import { normalizeWhatsappNumber } from "@/lib/phone";

type EvoResponse = { key?: { id?: string }; message?: string };

/** WhatsApp via Evolution API. Credentials: { baseUrl, apiKey, instance }. */
const adapter: ChannelAdapter = {
  async send(creds, input) {
    if (!creds.baseUrl || !creds.apiKey || !creds.instance) {
      return { ok: false, error: "Conexão Evolution incompleta." };
    }
    // Instance names may contain spaces (e.g. "METODO AI") — encode the segment.
    const url = `${creds.baseUrl.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(creds.instance)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { apikey: creds.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          number: normalizeWhatsappNumber(input.to),
          text: input.body,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as EvoResponse;
      if (!res.ok) {
        return { ok: false, error: data.message || `Evolution ${res.status}` };
      }
      return { ok: true, providerMessageId: data.key?.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erro Evolution" };
    }
  },
};

export default adapter;
