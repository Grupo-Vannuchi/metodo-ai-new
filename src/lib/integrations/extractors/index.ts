import "server-only";
import type { ExtractorAdapter } from "./types";
import type { ExtractorProviderKey } from "./meta";
import cnpj from "./cnpj";
import google from "./google";

/** Server-side adapter registry. */
export const EXTRACTORS: Record<ExtractorProviderKey, ExtractorAdapter> = {
  GOOGLE: google,
  CNPJ: cnpj,
};

export function getExtractor(provider: ExtractorProviderKey): ExtractorAdapter | null {
  return EXTRACTORS[provider] ?? null;
}
