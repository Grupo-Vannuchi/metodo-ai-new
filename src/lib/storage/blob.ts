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

/** Whether readMedia works with the active backend (Supabase or local disk). */
export function mediaReadable(): boolean {
  return supabaseEnabled() || !blobEnabled();
}

/**
 * Read stored bytes back by the pathname given to putMedia. Supabase is read
 * through the authenticated API (no public URL involved); local disk stays
 * inside .media/. Vercel Blob is not supported: its names get a random suffix,
 * so the pathname alone can't find the object.
 */
export async function readMedia(pathname: string): Promise<Buffer> {
  if (supabaseEnabled()) {
    const res = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/authenticated/${SUPABASE_BUCKET}/${pathname}`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) throw new Error(`Supabase read failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (blobEnabled()) throw new Error("readMedia is not supported on Vercel Blob");
  const file = path.resolve(LOCAL_DIR, pathname);
  if (!file.startsWith(LOCAL_DIR + path.sep)) throw new Error("Invalid media path");
  return fs.readFile(file);
}

/** Best-effort delete (LGPD): never throws so callers can fire-and-forget. It
 * dispatches by URL shape, so it handles media stored by any backend, private
 * files (a `private:` reference) included. */
export async function deleteMedia(url: string): Promise<void> {
  try {
    if (isPrivateRef(url)) {
      await deletePrivate(url);
      return;
    }
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

// ── Private files ───────────────────────────────────────────────────────────
// Files that must never be reachable by URL alone (HR documents): a PRIVATE
// Supabase bucket, or `.media-private/` on local disk. The row keeps a
// `private:<pathname>` reference instead of a URL, and the bytes are only served
// by an authenticated route (see privateFile), which checks session, company and
// permission first. Vercel Blob has no private mode, so it is not supported here.

const PRIVATE_BUCKET = "private";
const PRIVATE_REF = "private:";
const LOCAL_PRIVATE_DIR = path.join(process.cwd(), ".media-private");

/** True for a reference written by putPrivate (vs. a public media URL). */
export function isPrivateRef(value: string): boolean {
  return value.startsWith(PRIVATE_REF);
}

/** The pathname inside a reference, or null when it could leave its folder. */
function privatePathname(ref: string): string | null {
  const pathname = ref.slice(PRIVATE_REF.length);
  if (!pathname || pathname.startsWith("/") || pathname.includes("\\")) return null;
  if (pathname.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  return pathname;
}

// Create the private bucket once per process, and refuse to use it if someone
// made it public: a public bucket would serve these files to anyone with the URL.
let privateBucketReady: Promise<void> | null = null;
function ensurePrivateBucket(): Promise<void> {
  privateBucketReady ??= (async () => {
    const created = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...sbHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: PRIVATE_BUCKET, name: PRIVATE_BUCKET, public: false }),
    });
    if (!created.ok && created.status !== 400 && created.status !== 409) {
      privateBucketReady = null;
      throw new Error(`Supabase private bucket create failed: ${created.status}`);
    }
    const info = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket/${PRIVATE_BUCKET}`, { headers: sbHeaders() });
    const bucket = (await info.json().catch(() => null)) as { public?: boolean } | null;
    if (!info.ok || !bucket || bucket.public !== false) {
      privateBucketReady = null;
      throw new Error(`Supabase bucket "${PRIVATE_BUCKET}" is missing or public; refusing to store private files`);
    }
  })();
  return privateBucketReady;
}

/** Store a private file; returns the reference to keep on the row (never a URL). */
export async function putPrivate(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<{ ref: string; size: number }> {
  const ref = `${PRIVATE_REF}${pathname}`;
  if (!privatePathname(ref)) throw new Error("Invalid private file path");
  if (supabaseEnabled()) {
    await ensurePrivateBucket();
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${PRIVATE_BUCKET}/${pathname}`, {
      method: "POST",
      headers: { ...sbHeaders(), "Content-Type": contentType },
      body: new Uint8Array(body),
    });
    if (!res.ok) throw new Error(`Supabase private upload failed: ${res.status}`);
    return { ref, size: body.byteLength };
  }
  if (blobEnabled()) throw new Error("Private files need Supabase Storage (or local disk in development)");
  const file = path.join(LOCAL_PRIVATE_DIR, pathname);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return { ref, size: body.byteLength };
}

/**
 * The bytes of a private file, for the authenticated route to send. Supabase is
 * read through its authenticated API with the service key (the same read path
 * readMedia uses), so no link to the file ever reaches the browser. Null when the
 * reference is invalid or the file is gone.
 */
export async function readPrivate(ref: string): Promise<{ body: BodyInit } | null> {
  const pathname = privatePathname(ref);
  if (!pathname) return null;
  if (supabaseEnabled()) {
    const res = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/authenticated/${PRIVATE_BUCKET}/${pathname}`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok || !res.body) return null;
    return { body: res.body };
  }
  const file = path.resolve(LOCAL_PRIVATE_DIR, pathname);
  if (!file.startsWith(LOCAL_PRIVATE_DIR + path.sep)) return null;
  try {
    return { body: new Uint8Array(await fs.readFile(file)) };
  } catch {
    return null;
  }
}

async function deletePrivate(ref: string): Promise<void> {
  const pathname = privatePathname(ref);
  if (!pathname) return;
  if (supabaseEnabled()) {
    await fetch(`${env.SUPABASE_URL}/storage/v1/object/${PRIVATE_BUCKET}/${pathname}`, {
      method: "DELETE",
      headers: sbHeaders(),
    }).catch(() => {});
    return;
  }
  const file = path.resolve(LOCAL_PRIVATE_DIR, pathname);
  if (file.startsWith(LOCAL_PRIVATE_DIR + path.sep)) await fs.unlink(file).catch(() => {});
}
