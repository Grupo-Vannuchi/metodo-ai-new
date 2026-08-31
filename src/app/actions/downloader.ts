"use server";

import { getOrgContext } from "@/lib/tenant";
import { hasModule } from "@/config/modules";
import { resolveMedia, type ResolveResult } from "@/lib/downloader";

/** Resolve a social media link into downloadable file(s). Module-gated. */
export async function resolveDownload(url: string): Promise<ResolveResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, error: "failed" };
  if (!hasModule(ctx.modules, "downloader")) return { ok: false, error: "failed" };
  if (typeof url !== "string" || url.trim().length < 8) return { ok: false, error: "invalid_url" };
  return resolveMedia(url);
}
