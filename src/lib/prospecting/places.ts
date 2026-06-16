import "server-only";

/**
 * Google Places API (New) — Text Search client. Discovery only; each result's
 * website is enriched separately (see `scrape.ts`). The tenant supplies their
 * own API key (BYO), so the per-request cost is billed on their Google account.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */

export type PlaceResult = {
  placeId: string;
  name: string;
  segment: string;
  address: string;
  /** Raw provider phone (international preferred), normalized later on import. */
  phone: string;
  website: string;
  mapsUri: string;
  rating: number | null;
  businessStatus: string;
};

export type PlacesPage = { places: PlaceResult[]; nextPageToken: string | null };

export type PlacesErrorTag =
  | "BILLING_DISABLED"
  | "API_KEY_DENIED"
  | "SERVICE_DISABLED"
  | "INVALID"
  | "RATE_LIMIT"
  | "NETWORK"
  | "UNKNOWN";

export type PlacesError = { tag: PlacesErrorTag; message: string };

export type PlacesResult =
  | { ok: true; page: PlacesPage }
  | { ok: false; error: PlacesError };

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.types",
  "places.rating",
  "places.businessStatus",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

/** Max results Google returns per page; also the API's hard ceiling. */
export const PLACES_PAGE_SIZE = 20;

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  types?: string[];
  rating?: number;
  businessStatus?: string;
  primaryTypeDisplayName?: { text?: string };
};

function mapPlace(p: RawPlace): PlaceResult | null {
  const placeId = (p.id ?? "").trim();
  if (!placeId) return null;
  const segment =
    p.primaryTypeDisplayName?.text?.trim() ||
    (p.types?.[0] ? p.types[0].replace(/_/g, " ") : "");
  return {
    placeId,
    name: (p.displayName?.text ?? "").trim(),
    segment,
    address: (p.formattedAddress ?? "").trim(),
    phone: (p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? "").trim(),
    website: (p.websiteUri ?? "").trim(),
    mapsUri: (p.googleMapsUri ?? "").trim(),
    rating: typeof p.rating === "number" ? p.rating : null,
    businessStatus: (p.businessStatus ?? "").trim(),
  };
}

function mapError(status: number, body: unknown): PlacesError {
  const err =
    body && typeof body === "object" && "error" in body
      ? ((body as { error?: { status?: string; message?: string } }).error ?? {})
      : {};
  const gStatus = (err.status ?? "").toString();
  const msg = (err.message ?? "").toString();
  const lower = msg.toLowerCase();

  if (gStatus === "PERMISSION_DENIED" && lower.includes("billing")) {
    return { tag: "BILLING_DISABLED", message: msg };
  }
  if (gStatus === "PERMISSION_DENIED") {
    return { tag: "API_KEY_DENIED", message: msg };
  }
  if (gStatus === "SERVICE_DISABLED") {
    return { tag: "SERVICE_DISABLED", message: msg };
  }
  if (status === 429 || gStatus === "RESOURCE_EXHAUSTED") {
    return { tag: "RATE_LIMIT", message: msg || "Rate limit." };
  }
  if (status === 400 || gStatus === "INVALID_ARGUMENT") {
    return { tag: "INVALID", message: msg || "Invalid request." };
  }
  return { tag: "UNKNOWN", message: msg || `Places API error ${status}` };
}

/** Fetch a single page of results for `query`. */
export async function searchPlacesPage(
  apiKey: string,
  query: string,
  pageToken?: string,
  pageSize: number = PLACES_PAGE_SIZE,
): Promise<PlacesResult> {
  const payload: Record<string, unknown> = {
    textQuery: query,
    languageCode: "pt-BR",
    regionCode: "BR",
    pageSize: Math.max(1, Math.min(PLACES_PAGE_SIZE, pageSize)),
  };
  if (pageToken) payload.pageToken = pageToken;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    return {
      ok: false,
      error: { tag: "NETWORK", message: e instanceof Error ? e.message : "Network error" },
    };
  } finally {
    clearTimeout(timeout);
  }

  const body = (await res.json().catch(() => null)) as
    | { places?: RawPlace[]; nextPageToken?: string }
    | null;

  if (!res.ok || !body) {
    return { ok: false, error: mapError(res.status, body) };
  }

  const places = (body.places ?? [])
    .map(mapPlace)
    .filter((p): p is PlaceResult => p !== null);

  return {
    ok: true,
    page: { places, nextPageToken: body.nextPageToken?.trim() || null },
  };
}

/** Build the text query from the search form (mirrors the legacy extractor). */
export function buildPlacesQuery(input: {
  nome?: string;
  cnpj?: string;
  segmento?: string;
  localidade?: string;
}): string {
  return [input.nome, input.cnpj, input.segmento, input.localidade, "Brasil"]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
}
