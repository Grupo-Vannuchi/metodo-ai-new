import "server-only";
import { env } from "@/lib/env";
import { graphErrorFromBody } from "@/lib/whatsapp-cloud/errors";

/** Versão fixada da Graph API (a v20.0 expirou em 24/09/2026). */
export const DEFAULT_GRAPH_VERSION = "v26.0";
const TIMEOUT_MS = 20_000;

export function graphVersion(): string {
  const v = env.META_GRAPH_VERSION?.trim();
  return v && /^v\d+\.\d+$/.test(v) ? v : DEFAULT_GRAPH_VERSION;
}

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: number | null; message: string };

type GraphRequest = {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string>;
  json?: unknown;
  form?: FormData;
};

/**
 * Chamada à Graph API com o token do número. Nunca lança e nunca loga o token.
 * Erros da Meta vêm como HTTP 4xx com `error.code` (ver errors.ts).
 */
export async function graphRequest<T>(
  path: string,
  token: string,
  req: GraphRequest = {},
): Promise<GraphResult<T>> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (req.form) {
    body = req.form;
  } else if (req.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.json);
  }
  try {
    const res = await fetch(url, {
      method: req.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) return { ok: false, status: res.status, ...graphErrorFromBody(res.status, data) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, status: 0, code: null, message: e instanceof Error ? e.message : "Falha de rede com a Meta" };
  }
}

/**
 * Baixa os bytes de uma URL de mídia da Meta (vale 5 min e exige o mesmo token).
 * A URL vem da resposta autenticada de GET /{media-id}, nunca do payload do webhook.
 */
export async function graphDownload(
  url: string,
  token: string,
): Promise<{ ok: true; bytes: Buffer; mime: string | null } | { ok: false; status: number }> {
  try {
    if (new URL(url).protocol !== "https:") return { ok: false, status: 0 };
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") };
  } catch {
    return { ok: false, status: 0 };
  }
}
