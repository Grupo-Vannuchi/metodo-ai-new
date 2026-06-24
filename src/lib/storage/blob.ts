import "server-only";
import { put, del } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Object storage for chat media. Three interchangeable backends, picked by env:
 *
 *  - **Supabase Storage** (when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set)
 *    — the production path on Hostinger. REST API, no SDK. Public-but-unguessable
 *    object URLs (the path carries cuids only).
 *  - **Vercel Blob** (BLOB_READ_WRITE_TOKEN) — legacy/alt host.
 *  - **Local disk** (neither set, i.e. local dev) — bytes to `.media/`, served by
 *    `/api/media/[...path]`.
 *
 * Bytes never touch Postgres; the message row keeps only the returned URL.
 */
const LOCAL_DIR = path.join(process.cwd(), ".media");
const LOCAL_PREFIX = "/api/media/";
const SUPABASE_BUCKET = "media";
const SUPABASE_PUBLIC = `/storage/v1/object/public/${SUPABASE_BUCKET}/`;

function supabaseEnabled(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
function blobEnabled(): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

/** Storage always works (local disk is the fallback), so the pipeline can run. */
export function isStorageConfigured(): boolean {
  return true;
}

export type StoredMedia = { url: string; size: number };

// ── Supabase Storage (REST) ────────────────────────────────────────────────
function sbHeaders(): Record<string, string> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key };
}

// Create the (public) bucket once per process; ignore "already exists".
let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...sbHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, public: true }),
    });
    if (!res.ok && res.status !== 400 && res.status !== 409) {
      bucketReady = null; // allow a later retry
      throw new Error(`Supabase bucket ensure failed: ${res.status}`);
    }
  })();
  return bucketReady;
}

async function sbUpload(pathname: string, body: Buffer, contentType: string): Promise<string> {
  await ensureBucket();
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${pathname}`, {
    method: "POST",
    headers: { ...sbHeaders(), "Content-Type": contentType, "x-upsert": "true" },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    throw new Error(`Supabase upload failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return `${env.SUPABASE_URL}${SUPABASE_PUBLIC}${pathname}`;
}

async function sbDelete(publicUrl: string): Promise<void> {
  const i = publicUrl.indexOf(SUPABASE_PUBLIC);
  if (i < 0) return;
  const pathname = publicUrl.slice(i + SUPABASE_PUBLIC.length);
  await fetch(`${env.SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${pathname}`, {
    method: "DELETE",
    headers: sbHeaders(),
  }).catch(() => {});
}

// ── Public API ──────────────────────────────────────────────────────────────
/** Upload media bytes and return its URL + byte size. */
export async function putMedia(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<StoredMedia> {
  if (supabaseEnabled()) {
    return { url: await sbUpload(pathname, body, contentType), size: body.byteLength };
  }
  if (blobEnabled()) {
    const blob = await put(pathname, body, {
      access: "public",
      contentType,
      addRandomSuffix: true,
      token: env.BLOB_READ_WRITE_TOKEN,
    });
    return { url: blob.url, size: body.byteLength };
  }
  // Local dev: write under .media/ and serve through the media route.
  const file = path.join(LOCAL_DIR, pathname);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return { url: `${LOCAL_PREFIX}${pathname}`, size: body.byteLength };
}

/** Best-effort delete (LGPD): never throws so callers can fire-and-forget. It
 * dispatches by URL shape, so it handles media stored by any backend. */
export async function deleteMedia(url: string): Promise<void> {
  try {
    if (url.startsWith(LOCAL_PREFIX)) {
      const file = path.join(LOCAL_DIR, url.slice(LOCAL_PREFIX.length));
      if (file.startsWith(LOCAL_DIR)) await fs.unlink(file).catch(() => {});
      return;
    }
    if (url.includes(SUPABASE_PUBLIC)) {
      await sbDelete(url);
      return;
    }
    if (blobEnabled()) await del(url, { token: env.BLOB_READ_WRITE_TOKEN });
  } catch (error) {
    console.error("[storage] failed to delete", url, error);
  }
}
