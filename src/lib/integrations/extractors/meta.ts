import type { Feature } from "@/config/plans";

/**
 * Client-safe extractor metadata (labels, gating, form hints). Kept separate
 * from the adapter implementations so the "new extraction" form can render
 * provider options without importing server-only network code.
 */
export type ExtractorProviderKey =
  | "GOOGLE_MAPS"
  | "GOOGLE_CSE"
  | "CNPJ"
  | "INSTAGRAM"
  | "LINKEDIN";

export type ExtractorMeta = {
  label: string;
  description: string;
  feature: Feature;
  /** False = listed but not yet implemented. */
  available: boolean;
  /** Whether it needs a GOOGLE connection configured. */
  needsGoogle: boolean;
  queryLabel: string;
  queryPlaceholder: string;
};

export const EXTRACTOR_META: Record<ExtractorProviderKey, ExtractorMeta> = {
  CNPJ: {
    label: "CNPJ (BrasilAPI)",
    description: "Consulta dados públicos de uma empresa pelo CNPJ.",
    feature: "extractor.cnpj",
    available: true,
    needsGoogle: false,
    queryLabel: "CNPJ",
    queryPlaceholder: "00.000.000/0000-00",
  },
  GOOGLE_MAPS: {
    label: "Google Maps",
    description: "Encontra empresas por termo e localização (Places).",
    feature: "extractor.google",
    available: true,
    needsGoogle: true,
    queryLabel: "Busca",
    queryPlaceholder: "clínicas odontológicas em Santos",
  },
  GOOGLE_CSE: {
    label: "Google Custom Search",
    description: "Busca páginas/perfis na web via Custom Search.",
    feature: "extractor.google",
    available: true,
    needsGoogle: true,
    queryLabel: "Busca",
    queryPlaceholder: "imobiliárias São Paulo contato",
  },
  INSTAGRAM: {
    label: "Instagram",
    description: "Em breve.",
    feature: "extractor.social",
    available: false,
    needsGoogle: false,
    queryLabel: "Perfil/termo",
    queryPlaceholder: "",
  },
  LINKEDIN: {
    label: "LinkedIn",
    description: "Em breve.",
    feature: "extractor.social",
    available: false,
    needsGoogle: false,
    queryLabel: "Termo",
    queryPlaceholder: "",
  },
};

export const EXTRACTOR_KEYS = Object.keys(EXTRACTOR_META) as ExtractorProviderKey[];

export const AVAILABLE_EXTRACTORS = EXTRACTOR_KEYS.filter(
  (k) => EXTRACTOR_META[k].available,
);
