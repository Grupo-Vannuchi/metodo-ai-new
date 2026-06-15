import "server-only";
import type { ChannelAdapter } from "./types";

/** Email via Resend. Credentials: { apiKey, fromEmail }. */
const adapter: ChannelAdapter = {
  async send(creds, input) {
    const from = input.from || creds.fromEmail;
    if (!creds.apiKey || !from) {
      return { ok: false, error: "Conexão de e-mail sem apiKey/remetente." };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject || "(sem assunto)",
          html: input.body,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        return { ok: false, error: data.message || `Resend ${res.status}` };
      }
      return { ok: true, providerMessageId: data.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Erro Resend" };
    }
  },
};

export default adapter;
