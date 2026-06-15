import "server-only";
import type { ExtractorAdapter, LeadData } from "./types";
import {
  webSearch,
  fetchHtml,
  extractContactInfo,
  hostnameOf,
} from "./scrape-utils";

/** How many result sites to scrape per batch (keeps each job run short). */
const SITES_PER_BATCH = 6;

/**
 * Web scraper extractor: searches the web (DuckDuckGo HTML, no API key), then
 * scrapes each result site for contact info — website, email, phone, social
 * links. The search runs once; the remaining site URLs are carried in the
 * cursor so each batch stays short (chunking).
 */
const adapter: ExtractorAdapter = {
  requiresConnection: null,
  async run(params, cursor) {
    const query = String(params.query ?? "").trim();
    if (!query) throw new Error("Busca vazia.");

    let urls: string[];
    const carried = cursor?.urls;
    if (Array.isArray(carried)) {
      urls = carried as string[];
    } else {
      const { urls: found, blocked } = await webSearch(query);
      if (blocked && found.length === 0) {
        throw new Error("A busca não retornou resultados (bloqueio ou rede). Tente outra busca.");
      }
      urls = found;
    }

    const batch = urls.slice(0, SITES_PER_BATCH);
    const rest = urls.slice(SITES_PER_BATCH);

    const leads: LeadData[] = [];
    for (const url of batch) {
      const html = await fetchHtml(url, 9000);
      const info = html
        ? extractContactInfo(html, url)
        : { name: hostnameOf(url), emails: [], phones: [], socials: [] };
      leads.push({
        name: info.name ?? hostnameOf(url),
        website: url,
        email: info.emails[0],
        phone: info.phones[0],
        socials: info.socials,
        raw: {
          url,
          emails: info.emails,
          phones: info.phones,
          socials: info.socials,
        },
      });
    }

    const nextCursor = rest.length > 0 ? { urls: rest } : null;
    return { leads, nextCursor };
  },
};

export default adapter;
