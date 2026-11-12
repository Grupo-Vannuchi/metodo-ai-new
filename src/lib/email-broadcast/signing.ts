import { createHmac, timingSafeEqual } from "crypto";

/** HMAC-SHA256 as hex. Pure (no env) so the self-check can run it. */
export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Constant-time string compare; false on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
