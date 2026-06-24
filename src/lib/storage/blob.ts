import "server-only";
import { put, del } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Object storage for chat media. Two interchangeable backends, picked by env:
 *
 *  - **Vercel Blob** (when `BLOB_READ_WRITE_TOKEN` is set) — CDN-backed,
 *    public-but-unguessable URL. The production path.
 *  - **Local disk** (no token, i.e. local dev) — bytes go to `.media/` and are
 *    served by `/api/media/[...path]` (org-scoped). Lets the whole pipeline run
 *    locally without any cloud setup.
 *
 * Bytes never touch Postgres either way; the row keeps only the returned URL.
 */
const LOCAL_DIR = path.join(process.cwd(), ".media");
const LOCAL_PREFIX = "/api/media/";

function blobEnabled(): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

/** Storage always works (local disk is the fallback), so the pipeline can run. */
export function isStorageConfigured(): boolean {
  return true;
}

export type StoredMedia = { url: string; size: number };

/** Upload media bytes and return its URL + byte size. */
export async function putMedia(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<StoredMedia> {
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

/** Best-effort delete (LGPD): never throws so callers can fire-and-forget. */
export async function deleteMedia(url: string): Promise<void> {
  try {
    if (url.startsWith(LOCAL_PREFIX)) {
      const rel = url.slice(LOCAL_PREFIX.length);
      const file = path.join(LOCAL_DIR, rel);
      if (file.startsWith(LOCAL_DIR)) await fs.unlink(file).catch(() => {});
      return;
    }
    if (blobEnabled()) await del(url, { token: env.BLOB_READ_WRITE_TOKEN });
  } catch (error) {
    console.error("[storage] failed to delete", url, error);
  }
}
