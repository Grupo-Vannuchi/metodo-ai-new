import "server-only";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto";
import { SMTP_PORTS, type SmtpSettings } from "./core";

/**
 * What `EmailSenderAccount.credentials` holds for the SMTP account (encrypted
 * with INTEGRATION_ENC_KEY, like the OAuth tokens of the other two providers).
 * Server only: the password never goes to the browser, the log or the audit.
 * The port is kept as text because encryptCredentials only stores strings.
 */
export function sealSmtpSettings(s: SmtpSettings): string {
  return encryptCredentials({
    host: s.host,
    port: String(s.port),
    security: s.security,
    username: s.username,
    password: s.password,
  });
}

/**
 * The stored settings, or null when they can't be used: text that doesn't
 * decrypt, a missing field, a port outside SMTP_PORTS or an unknown security.
 * The dispatcher turns null into "reconnect".
 */
export function openSmtpSettings(sealed: string): SmtpSettings | null {
  try {
    const c = decryptCredentials(sealed);
    // Compared as text, so only the exact "465", "587" or "2525" matches.
    const port = SMTP_PORTS.find((p) => String(p) === c.port);
    const security = c.security === "ssl" || c.security === "starttls" ? c.security : null;
    if (!c.host || !c.username || !c.password || port === undefined || security === null) return null;
    return { host: c.host, port, security, username: c.username, password: c.password };
  } catch {
    return null;
  }
}
