import "server-only";

/**
 * Scraping helpers: search the web (no API key) and extract contact info
 * (email, phone, social links) from a page's HTML.
 *
 * Search backend: DuckDuckGo's HTML endpoint (html.duckduckgo.com/html/). Google
 * is NOT used because it blocks server-side requests with a consent/JS wall;
 * DuckDuckGo's HTML endpoint is designed to work without JS and returns real
 * organic results (encoded in `/l/?uddg=`), achieving the same goal with no key.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function fetchHtml(
  url: string,
  timeoutMs = 10000,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text/")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const SKIP_HOSTS =
  /google\.|gstatic\.|googleusercontent|youtube\.|youtu\.be|schema\.org|w3\.org|bing\.com|duckduckgo\.com|facebook\.com/i;

/** Parse organic result URLs from a DuckDuckGo HTML response. */
function parseResults(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\/l\/\?uddg=([^&"']+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 25) {
    let url: string;
    try {
      url = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    if (!/^https?:\/\//.test(url)) continue;
    const host = hostnameOf(url);
    if (!host || SKIP_HOSTS.test(host) || seen.has(host)) continue;
    seen.add(host);
    out.push(url);
  }
  return out;
}

export async function webSearch(
  query: string,
): Promise<{ urls: string[]; blocked: boolean }> {
  const u = new URL("https://html.duckduckgo.com/html/");
  u.searchParams.set("q", query);
  u.searchParams.set("kl", "br-pt");
  const html = await fetchHtml(u.toString(), 12000);
  if (!html) return { urls: [], blocked: true };
  if (/anomaly|are you a robot|unusual traffic/i.test(html) && !html.includes("uddg=")) {
    return { urls: [], blocked: true };
  }
  const urls = parseResults(html);
  return { urls, blocked: urls.length === 0 };
}

// --------------------------------------------------------------- contact info

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/g;
const SOCIAL_RE =
  /https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com|fb\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|tiktok\.com|wa\.me|api\.whatsapp\.com)\/[^\s"'<>)]+/gi;

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

function isJunkEmail(e: string): boolean {
  return (
    /\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e) ||
    /@(?:sentry|wixpress|example)/i.test(e) ||
    e.includes("@2x") ||
    e.length > 80
  );
}

export type ContactInfo = {
  name?: string;
  emails: string[];
  phones: string[];
  socials: string[];
};

export function extractContactInfo(html: string, baseUrl: string): ContactInfo {
  const emails = unique((html.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))
    .filter((e) => !isJunkEmail(e))
    .slice(0, 5);

  // tel: links are the cleanest source; fall back to text matches.
  const tel = [...html.matchAll(/href="tel:([^"]+)"/gi)].map((m) => m[1]);
  const phones = unique([...tel, ...(html.match(PHONE_RE) ?? [])])
    .map((p) => p.replace(/[^\d+]/g, ""))
    .filter((p) => {
      const d = p.replace(/\D/g, "");
      return d.length >= 10 && d.length <= 13;
    })
    .slice(0, 5);

  const socials = unique(
    (html.match(SOCIAL_RE) ?? []).map((s) => s.replace(/[)"'<>]+$/, "")),
  )
    .filter((s) => !/\/(?:sharer|share|intent|plugins|dialog)\b/i.test(s))
    .slice(0, 8);

  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const name = (title && title.length <= 120 ? title : undefined) ?? hostnameOf(baseUrl);

  return { name, emails, phones, socials };
}
