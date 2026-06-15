import type { Feature } from "@/config/plans";

/**
 * Client-safe extractor metadata (labels, gating, form hints). Kept separate
 * from the adapter implementations so the "new extraction" form can render
 * provider options without importing server-only scraping code.
 */
export type ExtractorProviderKey = "GOOGLE" | "CNPJ";

export type ExtractorMeta = {
  label: string;
  description: string;
  feature: Feature;
  available: boolean;
  queryLabel: string;
  queryPlaceholder: string;
};

export const EXTRACTOR_META: Record<ExtractorProviderKey, ExtractorMeta> = {
  GOOGLE: {
    label: "Busca na web (scraper)",
    description:
      "Busca empresas na web e raspa site, e-mail, telefone e redes sociais das páginas. Sem necessidade de API ou chave.",
    feature: "extractor.google",
    available: true,
    queryLabel: "Busca",
    queryPlaceholder: "clínicas odontológicas em Santos",
  },
  CNPJ: {
    label: "CNPJ (BrasilAPI)",
    description: "Consulta dados públicos de uma empresa pelo CNPJ.",
    feature: "extractor.cnpj",
    available: true,
    queryLabel: "CNPJ",
    queryPlaceholder: "00.000.000/0000-00",
  },
};

export const EXTRACTOR_KEYS = Object.keys(EXTRACTOR_META) as ExtractorProviderKey[];

export const AVAILABLE_EXTRACTORS = EXTRACTOR_KEYS.filter(
  (k) => EXTRACTOR_META[k].available,
);
