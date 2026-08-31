import "server-only";
import ytdl from "@distube/ytdl-core";

/**
 * Video downloader resolvers (Node-only MVP): given a public link from YouTube,
 * X (Twitter) or Instagram, resolve the direct media file(s) to download.
 *
 * Reliability caveat: these public endpoints change often (especially Instagram
 * and X), so failures are expected and handled gracefully. Downloads go through
 * the server proxy (`/api/downloader/fetch`) so the fetch IP matches the one
 * that resolved the (often IP-signed) URL.
 */

export type MediaSource = "youtube" | "twitter" | "instagram";

export type MediaFormat = {
  /** Human label (e.g. "1080p", "720p", "Vídeo"). */
  label: string;
  /** Direct media URL (proxied for download). */
  url: string;
  ext: string;
};

export type MediaInfo = {
  source: MediaSource;
  title: string;
  author?: string;
  thumbnail?: string;
  formats: MediaFormat[];
};

export type ResolveError = "invalid_url" | "unsupported" | "not_found" | "private" | "no_video" | "failed";
export type ResolveResult = { ok: true; data: MediaInfo } | { ok: false; error: ResolveError };

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Hosts the download proxy is allowed to stream from (anti-SSRF). */
export const ALLOWED_MEDIA_HOSTS = [
  "googlevideo.com",
  "youtube.com",
  "cdninstagram.com",
  "fbcdn.net",
  "twimg.com",
];

export function isAllowedMediaHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return ALLOWED_MEDIA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Detect the platform from a URL. */
export function detectSource(url: string): MediaSource | null {
  const h = url.toLowerCase();
  if (/(?:^|\.)youtube\.com|youtu\.be/.test(h)) return "youtube";
  if (/(?:^|\.)twitter\.com|(?:^|\.)x\.com/.test(h)) return "twitter";
  if (/(?:^|\.)instagram\.com/.test(h)) return "instagram";
  return null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Entry point: detect the source and resolve the media. Never throws. */
export async function resolveMedia(url: string): Promise<ResolveResult> {
  const trimmed = url.trim();
  let source: MediaSource | null;
  try {
    new URL(trimmed);
    source = detectSource(trimmed);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (!source) return { ok: false, error: "unsupported" };

  try {
    if (source === "youtube") return await resolveYouTube(trimmed);
    if (source === "twitter") return await resolveTwitter(trimmed);
    return await resolveInstagram(trimmed);
  } catch (error) {
    console.error(`[downloader] ${source} failed`, error);
    return { ok: false, error: "failed" };
  }
}

// ── YouTube ──────────────────────────────────────────────────────────────────
async function resolveYouTube(url: string): Promise<ResolveResult> {
  if (!ytdl.validateURL(url)) return { ok: false, error: "invalid_url" };
  const info = await ytdl.getInfo(url);
  const d = info.videoDetails;

  // Progressive (video+audio) MP4 formats — ready to download as-is.
  const progressive = ytdl
    .filterFormats(info.formats, "videoandaudio")
    .filter((f) => f.container === "mp4")
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  const seen = new Set<string>();
  const formats: MediaFormat[] = [];
  for (const f of progressive) {
    const label = f.qualityLabel || (f.height ? `${f.height}p` : "Vídeo");
    if (seen.has(label) || !f.url) continue;
    seen.add(label);
    formats.push({ label, url: f.url, ext: "mp4" });
  }
  if (formats.length === 0) {
    const best = ytdl.chooseFormat(info.formats, { quality: "highest" });
    if (best?.url) formats.push({ label: best.qualityLabel || "Vídeo", url: best.url, ext: best.container || "mp4" });
  }
  if (formats.length === 0) return { ok: false, error: "no_video" };

  return {
    ok: true,
    data: {
      source: "youtube",
      title: d.title,
      author: d.author?.name,
      thumbnail: d.thumbnails?.at(-1)?.url,
      formats,
    },
  };
}

// ── X (Twitter) ──────────────────────────────────────────────────────────────
function tweetId(url: string): string | null {
  return url.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i)?.[1] ?? null;
}
/** Token the public syndication endpoint expects (react-tweet algorithm). */
function syndToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

type TwVariant = { bitrate?: number; content_type?: string; url?: string };
type TwMedia = { type?: string; media_url_https?: string; video_info?: { variants?: TwVariant[] } };
type TwResult = { text?: string; user?: { name?: string }; mediaDetails?: TwMedia[] };

async function resolveTwitter(url: string): Promise<ResolveResult> {
  const id = tweetId(url);
  if (!id) return { ok: false, error: "invalid_url" };
  const api = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndToken(id)}&lang=pt`;
  const res = await fetch(api, { headers: { "User-Agent": DESKTOP_UA, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return { ok: false, error: res.status === 404 ? "not_found" : "failed" };
  const j = (await res.json()) as TwResult;

  const media = (j.mediaDetails ?? []).find((m) => m.video_info?.variants?.length);
  const variants = media?.video_info?.variants ?? [];
  const mp4 = variants
    .filter((v) => v.content_type === "video/mp4" && v.url)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  if (mp4.length === 0) return { ok: false, error: "no_video" };

  const seen = new Set<string>();
  const formats: MediaFormat[] = [];
  for (const v of mp4) {
    const label = v.bitrate ? `${Math.round(v.bitrate / 1000)} kbps` : "Vídeo";
    if (seen.has(label)) continue;
    seen.add(label);
    formats.push({ label, url: v.url!, ext: "mp4" });
  }

  return {
    ok: true,
    data: {
      source: "twitter",
      title: (j.text ?? "Vídeo do X").slice(0, 90),
      author: j.user?.name,
      thumbnail: media?.media_url_https,
      formats,
    },
  };
}

// ── Instagram ────────────────────────────────────────────────────────────────
async function resolveInstagram(url: string): Promise<ResolveResult> {
  const res = await fetch(url, {
    headers: { "User-Agent": DESKTOP_UA, "Accept-Language": "en-US,en;q=0.9" },
    cache: "no-store",
    redirect: "follow",
  });
  if (!res.ok) return { ok: false, error: res.status === 404 ? "not_found" : "failed" };
  const html = await res.text();

  const og = html.match(/<meta property="og:video"[^>]*content="([^"]+)"/i)?.[1];
  const jsonUrl = html.match(/"video_url":"([^"]+)"/)?.[1];
  let videoUrl: string | null = null;
  if (og) videoUrl = decodeHtml(og);
  else if (jsonUrl) {
    try {
      videoUrl = JSON.parse(`"${jsonUrl}"`);
    } catch {
      videoUrl = null;
    }
  }
  // Login wall / no public video available.
  if (!videoUrl) return { ok: false, error: "private" };

  const title = html.match(/<meta property="og:title"[^>]*content="([^"]+)"/i)?.[1];
  const thumb = html.match(/<meta property="og:image"[^>]*content="([^"]+)"/i)?.[1];

  return {
    ok: true,
    data: {
      source: "instagram",
      title: title ? decodeHtml(title).slice(0, 90) : "Vídeo do Instagram",
      thumbnail: thumb ? decodeHtml(thumb) : undefined,
      formats: [{ label: "Vídeo", url: videoUrl, ext: "mp4" }],
    },
  };
}
