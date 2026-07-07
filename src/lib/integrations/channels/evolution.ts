import "server-only";
import type { ChannelAdapter } from "./types";
import { normalizeWhatsappNumber } from "@/lib/phone";

type EvoResponse = { key?: { id?: string } };

/** Evolution nests error details in different shapes across versions — dig out a
 * human-readable message (falling back to the status code). */
function evolutionError(data: unknown, status: number): string {
  const flat = (v: unknown): string | null => {
    if (typeof v === "string") return v.trim() || null;
    if (Array.isArray(v)) return v.map((x) => flat(x)).filter(Boolean).join("; ") || null;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return flat(o.message) ?? flat(o.error) ?? flat(o.response) ?? flat(o.exception);
    }
    return null;
  };
  return flat(data) ?? `Evolution ${status}`;
}

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
          ...(input.quoted
            ? {
                quoted: {
                  key: {
                    id: input.quoted.messageId,
                    remoteJid: input.quoted.remoteJid,
                    fromMe: input.quoted.fromMe,
                  },
                  message: { conversation: input.quoted.body },
                },
              }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as EvoResponse & Record<string, unknown>;
      if (!res.ok) {
        const message = evolutionError(data, res.status);
        console.error(`[evolution] send ${res.status}: ${message} | to=${normalizeWhatsappNumber(input.to)}`);
        return { ok: false, error: message };
      }
      return { ok: true, providerMessageId: data.key?.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erro Evolution" };
    }
  },

  async sendMedia(creds, input) {
    if (!creds.baseUrl || !creds.apiKey || !creds.instance) {
      return { ok: false, error: "Conexão Evolution incompleta." };
    }
    const base = creds.baseUrl.replace(/\/$/, "");
    const inst = encodeURIComponent(creds.instance);
    const number = normalizeWhatsappNumber(input.to);
    // Voice notes use a dedicated endpoint; everything else goes via sendMedia.
    const isAudio = input.mediatype === "audio";
    const url = isAudio
      ? `${base}/message/sendWhatsAppAudio/${inst}`
      : `${base}/message/sendMedia/${inst}`;
    const body = isAudio
      ? { number, audio: input.media }
      : {
          number,
          mediatype: input.mediatype,
          mimetype: input.mimetype,
          caption: input.caption || undefined,
          media: input.media,
          fileName: input.fileName,
        };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { apikey: creds.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as EvoResponse & Record<string, unknown>;
      if (!res.ok) {
        const message = evolutionError(data, res.status);
        console.error(`[evolution] sendMedia ${res.status}: ${message} | to=${number}`);
        return { ok: false, error: message };
      }
      return { ok: true, providerMessageId: data.key?.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erro Evolution" };
    }
  },

  async sendReaction(creds, input) {
    if (!creds.baseUrl || !creds.apiKey || !creds.instance) {
      return { ok: false, error: "Conexão Evolution incompleta." };
    }
    const url = `${creds.baseUrl.replace(/\/$/, "")}/message/sendReaction/${encodeURIComponent(creds.instance)}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { apikey: creds.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          key: { remoteJid: input.remoteJid, fromMe: input.fromMe, id: input.messageId },
          reaction: input.emoji,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as EvoResponse & Record<string, unknown>;
      if (!res.ok) {
        const message = evolutionError(data, res.status);
        console.error(`[evolution] sendReaction ${res.status}: ${message}`);
        return { ok: false, error: message };
      }
      return { ok: true, providerMessageId: data.key?.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erro Evolution" };
    }
  },
};

export default adapter;
