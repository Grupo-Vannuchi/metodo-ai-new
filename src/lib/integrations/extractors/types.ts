/**
 * Extractor adapter contract. Each provider implements `run` to fetch ONE batch
 * of leads and return the cursor for the next batch (or null when complete), so
 * the runner can chunk long extractions across queue invocations.
 */
export type ExtractorParams = Record<string, unknown>;
export type Cursor = Record<string, unknown> | null;

export type LeadData = {
  name?: string;
  cnpj?: string;
  email?: string;
  phone?: string;
  website?: string;
  /** Social profile URLs found on the page. */
  socials?: string[];
  raw: Record<string, unknown>;
};

export type ExtractorResult = {
  leads: LeadData[];
  /** null = no more pages. */
  nextCursor: Cursor;
};

export type ExtractorContext = {
  /** Decrypted credentials of the required connection, when applicable. */
  credentials: Record<string, string> | null;
};

export interface ExtractorAdapter {
  /** Which integration connection (if any) this adapter needs. */
  requiresConnection: "GOOGLE" | null;
  run(
    params: ExtractorParams,
    cursor: Cursor,
    ctx: ExtractorContext,
  ): Promise<ExtractorResult>;
}
