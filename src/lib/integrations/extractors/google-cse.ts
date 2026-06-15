import "server-only";
import type { ExtractorAdapter, LeadData } from "./types";

type CseItem = { title?: string; link?: string; snippet?: string };
type CseResponse = {
  items?: CseItem[];
  queries?: { nextPage?: { startIndex?: number }[] };
};

/** Google Custom Search — paginates via `start` (max 100 results). */
const adapter: ExtractorAdapter = {
  requiresConnection: "GOOGLE",
  async run(params, cursor, ctx) {
    const apiKey = ctx.credentials?.apiKey;
    const cx = ctx.credentials?.cseCx;
    if (!apiKey || !cx) {
      throw new Error("Conexão Google sem apiKey/cseCx para Custom Search.");
    }
    const query = String(params.query ?? "").trim();
    if (!query) throw new Error("Busca vazia.");

    const start = Number(cursor?.start ?? 1);
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("cx", cx);
    url.searchParams.set("q", query);
    url.searchParams.set("start", String(start));

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Google CSE retornou ${res.status}`);
    const data = (await res.json()) as CseResponse;

    const leads: LeadData[] = (data.items ?? []).map((it) => ({
      name: it.title,
      raw: it as Record<string, unknown>,
    }));

    const nextStart = data.queries?.nextPage?.[0]?.startIndex;
    const nextCursor =
      nextStart && start < 91 ? { start: nextStart } : null;

    return { leads, nextCursor };
  },
};

export default adapter;
