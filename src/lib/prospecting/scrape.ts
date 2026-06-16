import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * Website enrichment for prospecting. Given a business website (discovered via
 * Google Places), fetch its public pages and pull contact info: e-mails, phones,
 * WhatsApp links and social profiles. This is the company's own public data.
 *
 * Hardened against SSRF (no localhost / private / reserved IPs) and bounded in
 * time and size so it's safe to run many in parallel from the job runner.
 */

export type SiteContacts = {
  emails: string[];
  phones: string[];
  whatsapp: string[];
  instagram: string;
  facebook: string;
  linkedin: string;
  title: string;
  description: string;
};

const EMPTY: SiteContacts = {
  emails: [],
  phones: [],
  whatsapp: [],
  instagram: "",
  facebook: "",
  linkedin: "",
  title: "",
  description: "",
};

const HOME_TIMEOUT_MS = 8_000;
const LINK_TIMEOUT_MS = 5_000;
const MAX_HTML_CHARS = 600_000;
const MAX_CONTACT_LINKS = 3;

// ---------------------------------------------------------------- SSRF guard

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return true;
    const inRange = (a: string, bits: number) =>
      (n >>> (32 - bits)) === ((ipv4ToInt(a)! >>> (32 - bits)) >>> 0);
    return (
      inRange("10.0.0.0", 8) ||
      inRange("172.16.0.0", 12) ||
      inRange("192.168.0.0", 16) ||
      inRange("127.0.0.0", 8) ||
      inRange("169.254.0.0", 16) || // link-local
      inRange("100.64.0.0", 10) || // CGNAT
      inRange("0.0.0.0", 8)
    );
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80") || // link-local
      lower.startsWith("fc") ||
      lower.startsWith("fd") || // unique local
      lower === "::"
    );
  }
  return true;
}

async function isSafeUrl(raw: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- extraction

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#0*64;/g, "@")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function uniqueNonEmpty(items: string[], limit: number): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

function cleanEmail(raw: string): string {
  const e = raw.trim().replace(/^[<("'.,;:]+|[>)"'.,;:]+$/g, "").toLowerCase();
  if (!e) return "";
  // Skip image/asset look-alikes.
  if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e)) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : "";
}

/** Normalize a phone string to "+55XXXXXXXXXXX" (BR) or "" if implausible. */
function normalizePhone(raw: string): string {
  if (raw.includes("/")) return ""; // avoids capturing CNPJ as phone
  const hadPlus = raw.trim().startsWith("+");
  const digits = decodeEntities(raw).replace(/\D+/g, "");
  if (!digits) return "";
  const len = digits.length;
  if (len === 10 || len === 11) return `+55${digits}`;
  if (digits.startsWith("55") && (len === 12 || len === 13)) return `+${digits}`;
  if (hadPlus && len >= 11 && len <= 15) return `+${digits}`;
  return "";
}

function extractEmails(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/mailto:([^"'<>\s]+)/gi)) {
    const e = cleanEmail(decodeURIComponent(m[1]));
    if (e) out.push(e);
  }
  for (const m of html.matchAll(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi)) {
    const e = cleanEmail(m[0]);
    if (e) out.push(e);
  }
  return out;
}

function extractPhones(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/tel:([^"'<>\s]+)/gi)) {
    const p = normalizePhone(decodeURIComponent(m[1]));
    if (p) out.push(p);
  }
  for (const m of html.matchAll(/\+?\d[\d\-\s().]{7,}\d/g)) {
    const p = normalizePhone(m[0]);
    if (p) out.push(p);
  }
  return out;
}

function extractWhatsapp(html: string): string[] {
  const out: string[] = [];
  const re =
    /(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/send\?phone=)(\+?\d{8,15})/gi;
  for (const m of html.matchAll(re)) {
    const digits = m[1].replace(/\D+/g, "");
    if (digits) out.push(`https://wa.me/${digits}`);
  }
  return out;
}

function extractSocials(html: string): Pick<SiteContacts, "instagram" | "facebook" | "linkedin"> {
  const found = { instagram: "", facebook: "", linkedin: "" };
  const re =
    /href\s*=\s*["'](https?:\/\/(?:www\.)?(instagram\.com|facebook\.com|linkedin\.com)\/[^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    const link = m[1];
    const domain = m[2].toLowerCase();
    const lower = link.toLowerCase();
    if (lower.includes("sharer") || lower.includes("share") || lower.includes("intent")) {
      continue;
    }
    if (domain === "instagram.com" && !found.instagram) found.instagram = link;
    if (domain === "facebook.com" && !found.facebook) found.facebook = link;
    if (domain === "linkedin.com" && !found.linkedin) found.linkedin = link;
  }
  return found;
}

function extractMeta(html: string): { title: string; description: string } {
  let title = "";
  let description = "";
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tm) title = tm[1].replace(/<[^>]+>/g, "").trim();
  const dm =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) ??
    html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
  if (dm) description = dm[1].trim();
  return { title, description };
}

function absoluteUrl(base: string, href: string): string | null {
  const h = decodeEntities(href).trim();
  if (!h || /^(mailto:|tel:|javascript:|#)/i.test(h)) return null;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

function extractContactLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const abs = absoluteUrl(base, m[1]);
    if (!abs) continue;
    const l = abs.toLowerCase();
    if (/contato|contact|fale-conosco|atendimento|suporte/.test(l)) out.push(abs);
    if (out.length >= MAX_CONTACT_LINKS * 2) break;
  }
  return uniqueNonEmpty(out, MAX_CONTACT_LINKS);
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "User-Agent": "MetodoAI-Prospecting/1.0 (+https://metodoai.com.br)",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !ct.includes("html") && !ct.includes("text")) return null;
    const text = await res.text();
    return text.slice(0, MAX_HTML_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parse(html: string): SiteContacts {
  const socials = extractSocials(html);
  const meta = extractMeta(html);
  return {
    emails: extractEmails(html),
    phones: extractPhones(html),
    whatsapp: extractWhatsapp(html),
    ...socials,
    title: meta.title,
    description: meta.description,
  };
}

/** Scrape a business website (home + up to 3 contact pages) for contacts. */
export async function enrichFromWebsite(rawWebsite: string): Promise<SiteContacts> {
  const website = rawWebsite.trim();
  if (!website) return EMPTY;
  const url = /^https?:\/\//i.test(website) ? website : `https://${website.replace(/^\/+/, "")}`;

  if (!(await isSafeUrl(url))) return EMPTY;
  const home = await fetchHtml(url, HOME_TIMEOUT_MS);
  if (!home) return EMPTY;

  const agg = parse(home);

  for (const link of extractContactLinks(home, url)) {
    if (!(await isSafeUrl(link))) continue;
    const html = await fetchHtml(link, LINK_TIMEOUT_MS);
    if (!html) continue;
    const p = parse(html);
    agg.emails.push(...p.emails);
    agg.phones.push(...p.phones);
    agg.whatsapp.push(...p.whatsapp);
    if (!agg.instagram) agg.instagram = p.instagram;
    if (!agg.facebook) agg.facebook = p.facebook;
    if (!agg.linkedin) agg.linkedin = p.linkedin;
  }

  return {
    ...agg,
    emails: uniqueNonEmpty(agg.emails, 5),
    phones: uniqueNonEmpty(agg.phones, 5),
    whatsapp: uniqueNonEmpty(agg.whatsapp, 3),
  };
}
