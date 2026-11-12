import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Confere o `X-Hub-Signature-256` que a Meta manda em todo POST de webhook: um
 * HMAC-SHA256 dos bytes CRUS do corpo com o App Secret (puro). Fail-closed: sem
 * segredo ou sem cabeçalho, recusa. Compara em tempo constante.
 */
export function verifySignature(
  rawBody: Uint8Array,
  header: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !header) return false;
  const prefix = "sha256=";
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Comparação de strings em tempo constante (token de verificação do GET). */
export function safeEqualString(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
