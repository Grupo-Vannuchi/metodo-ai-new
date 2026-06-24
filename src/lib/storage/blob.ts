import "server-only";
import { put, del } from "@vercel/blob";
import { env } from "@/lib/env";

/**
 * Object storage for chat media (Vercel Blob). Bytes never touch Postgres — we
 * keep only the returned URL on the message row. Blobs are public-but-
 * unguessable (random suffix in the URL) and only ever exposed to authenticated
 * org members through the org-scoped messages API. When the token is absent the
 * pipeline degrades gracefully (media stays PENDING) instead of throwing.
 */
export function isBlobConfigured(): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

export type StoredMedia = { url: string; size: number };

/** Upload media bytes and return the CDN URL + byte size. */
export async function putMedia(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<StoredMedia> {
  const blob = await put(pathname, body, {
    access: "public",
    contentType,
    addRandomSuffix: true,
    token: env.BLOB_READ_WRITE_TOKEN,
  });
  return { url: blob.url, size: body.byteLength };
}

/** Best-effort delete (LGPD): never throws so callers can fire-and-forget. */
export async function deleteMedia(url: string): Promise<void> {
  if (!isBlobConfigured()) return;
  try {
    await del(url, { token: env.BLOB_READ_WRITE_TOKEN });
  } catch (error) {
    console.error("[blob] failed to delete", url, error);
  }
}
