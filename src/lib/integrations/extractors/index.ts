import "server-only";
import type { ExtractorAdapter } from "./types";
import type { ExtractorProviderKey } from "./meta";
import cnpj from "./cnpj";
import googleCse from "./google-cse";
import googleMaps from "./google-maps";

/** Server-side adapter registry. Unimplemented providers are absent. */
export const EXTRACTORS: Partial<Record<ExtractorProviderKey, ExtractorAdapter>> = {
  CNPJ: cnpj,
  GOOGLE_CSE: googleCse,
  GOOGLE_MAPS: googleMaps,
};

export function getExtractor(provider: ExtractorProviderKey): ExtractorAdapter | null {
  return EXTRACTORS[provider] ?? null;
}
