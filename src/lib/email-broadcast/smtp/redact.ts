/**
 * Keeps an SMTP account's password out of any text that is stored or shown
 * (spec 2026-10-21, 7). Pure on purpose: no server imports and no node
 * built-ins but the Buffer global, so check:email can pin it. It is server
 * code all the same: it takes the password, so no client component may import it.
 */

/**
 * The text with the password, and what the login sends of it, replaced by
 * "***": the password as typed, and the base64 a server may echo back from
 * AUTH (LOGIN sends the user and the password each in base64, PLAIN the blob
 * "\0user\0password"), with or without its "=" padding. Run it on the text as
 * it came, before any reformatting or cutting, so each secret is found whole
 * and as the server wrote it. With no password there is nothing to hide, and
 * an empty form (an empty user's) is never searched for: it would match
 * between every character.
 */
export function redactSmtpSecrets(text: string, s: { username: string; password: string }): string {
  if (!s.password) return text;
  const base64 = [s.password, s.username, `\0${s.username}\0${s.password}`].map((value) =>
    Buffer.from(value, "utf8").toString("base64"),
  );
  const secrets = [...new Set([s.password, ...base64, ...base64.map((b) => b.replace(/=+$/, ""))])]
    .filter((secret) => secret !== "")
    // Longest first: a shorter secret inside a longer one must not cut it and leave the rest of it in the text.
    .sort((a, b) => b.length - a.length);
  return secrets.reduce((out, secret) => out.split(secret).join("***"), text);
}
