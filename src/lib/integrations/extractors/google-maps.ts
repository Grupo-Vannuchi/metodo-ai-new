import "server-only";
import type { ExtractorAdapter, LeadData } from "./types";

type Place = {
  name?: string;
  formatted_address?: string;
  place_id?: string;
  international_phone_number?: string;
};
type PlacesResponse = {
  results?: Place[];
  next_page_token?: string;
  status?: string;
  error_message?: string;
};

/** Google Places Text Search — paginates via `next_page_token`. */
const adapter: ExtractorAdapter = {
  requiresConnection: "GOOGLE",
  async run(params, cursor, ctx) {
    const apiKey = ctx.credentials?.apiKey;
    if (!apiKey) throw new Error("Conexão Google sem apiKey para Places.");
    const query = String(params.query ?? "").trim();
    if (!query) throw new Error("Busca vazia.");

    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/textsearch/json",
    );
    url.searchParams.set("query", query);
    url.searchParams.set("key", apiKey);
    const pageToken = cursor?.pageToken ? String(cursor.pageToken) : "";
    if (pageToken) url.searchParams.set("pagetoken", pageToken);

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Google Places retornou ${res.status}`);
    const data = (await res.json()) as PlacesResponse;
    if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new Error(`Google Places: ${data.status} ${data.error_message ?? ""}`);
    }

    const leads: LeadData[] = (data.results ?? []).map((p) => ({
      name: p.name,
      phone: p.international_phone_number,
      raw: p as Record<string, unknown>,
    }));

    const nextCursor = data.next_page_token
      ? { pageToken: data.next_page_token }
      : null;

    return { leads, nextCursor };
  },
};

export default adapter;
