import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "@/lib/env";

/**
 * Symmetric encryption for integration credentials (AES-256-GCM).
 *
 * Credentials are stored as a single opaque string `iv:tag:ciphertext` (all
 * base64). The key comes from `INTEGRATION_ENC_KEY` (32 bytes / 64 hex). Never
 * store plaintext credentials; only decrypt at the moment of use, on the server.
 */
const KEY = Buffer.from(env.INTEGRATION_ENC_KEY, "hex");
const IV_BYTES = 12;

export type Credentials = Record<string, string>;

export function encryptCredentials(creds: Credentials): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(creds), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptCredentials(payload: string): Credentials {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted credentials");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    KEY,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Credentials;
}
