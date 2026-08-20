"use server";

import { getOrgContext } from "@/lib/tenant";
import { onlyDigits, formatCep } from "@/lib/cnpj";

/** Address fields we can derive from a Brazilian postal code (CEP). */
export type CepAddress = {
  street: string;
  neighborhood: string;
  city: string;
  uf: string;
  zip: string;
};

export type CepLookupResult =
  | { ok: true; data: CepAddress }
  | { ok: false; error: "unauthorized" | "invalid" | "notFound" | "unavailable" };

type BrasilApiCep = {
  cep?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
};

/**
 * Resolve a Brazilian address from a CEP (postal code) via the free BrasilAPI —
 * no key needed, same provider as the CNPJ lookup. Returns normalized fields;
 * the client fills the blanks. Auth-gated so it isn't an open proxy.
 */
export async function lookupCep(cep: string): Promise<CepLookupResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "unauthorized" };

  const digits = onlyDigits(cep);
  if (digits.length !== 8) return { ok: false, error: "invalid" };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "MetodoAI-CRM/1.0" },
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (res.status === 404) return { ok: false, error: "notFound" };
    if (!res.ok) return { ok: false, error: "unavailable" };

    const j = (await res.json()) as BrasilApiCep;
    return {
      ok: true,
      data: {
        street: (j.street ?? "").trim(),
        neighborhood: (j.neighborhood ?? "").trim(),
        city: (j.city ?? "").trim(),
        uf: (j.state ?? "").trim(),
        zip: formatCep(digits),
      },
    };
  } catch (error) {
    console.error("CEP lookup failed", error);
    return { ok: false, error: "unavailable" };
  }
}
