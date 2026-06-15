import "server-only";
import type { ExtractorAdapter, LeadData } from "./types";

/** CNPJ lookup via BrasilAPI (no API key required). Single result, one batch. */
const adapter: ExtractorAdapter = {
  requiresConnection: null,
  async run(params) {
    const cnpj = String(params.cnpj ?? params.query ?? "").replace(/\D/g, "");
    if (cnpj.length !== 14) {
      throw new Error("CNPJ inválido: informe 14 dígitos.");
    }

    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      // BrasilAPI rejects requests without a User-Agent (403).
      headers: { Accept: "application/json", "User-Agent": "MetodoAI/1.0" },
    });
    if (res.status === 404) {
      return { leads: [], nextCursor: null };
    }
    if (!res.ok) {
      throw new Error(`BrasilAPI retornou ${res.status}`);
    }

    const d = (await res.json()) as Record<string, unknown>;
    const lead: LeadData = {
      name: String(d.nome_fantasia || d.razao_social || "").trim() || undefined,
      cnpj,
      email: (d.email as string) || undefined,
      phone: (d.ddd_telefone_1 as string) || undefined,
      raw: d,
    };
    return { leads: [lead], nextCursor: null };
  },
};

export default adapter;
