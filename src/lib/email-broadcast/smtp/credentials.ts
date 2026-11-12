import "server-only";
import { decryptCredentials, encryptCredentials, type Credentials } from "@/lib/integrations/crypto";
import { IMAP_PORTS, type ImapSettings } from "../imap/core";
import { SMTP_PORTS, type SmtpSettings } from "./core";

/**
 * What `EmailSenderAccount.credentials` holds for the SMTP account (encrypted
 * with INTEGRATION_ENC_KEY, like the OAuth tokens of the other two providers).
 * Server only: the password never goes to the browser, the log or the audit.
 * The ports are kept as text because encryptCredentials only stores strings. An
 * account that reads its inbox (spec 2026-10-23) also holds imapHost, imapPort
 * and imapSecurity; one that only sends is stored without them, as it always was.
 */
export function sealSmtpSettings(s: SmtpSettings): string {
  return encryptCredentials({
    host: s.host,
    port: String(s.port),
    security: s.security,
    username: s.username,
    password: s.password,
    ...(s.imap ? { imapHost: s.imap.host, imapPort: String(s.imap.port), imapSecurity: s.imap.security } : {}),
  });
}

/**
 * The stored settings, or null when they can't be used: text that doesn't
 * decrypt, a missing field, a port outside SMTP_PORTS or an unknown security.
 * The dispatcher turns null into "reconnect". The inbox half never decides that:
 * an account sealed before it existed, or with IMAP keys that can't be used, opens
 * all the same with `imap: null` and only loses its inbox.
 */
export function openSmtpSettings(sealed: string): SmtpSettings | null {
  try {
    const c = decryptCredentials(sealed);
    // Compared as text, so only the exact "465", "587" or "2525" matches.
    const port = SMTP_PORTS.find((p) => String(p) === c.port);
    const security = c.security === "ssl" || c.security === "starttls" ? c.security : null;
    if (!c.host || !c.username || !c.password || port === undefined || security === null) return null;
    return { host: c.host, port, security, username: c.username, password: c.password, imap: openImapSettings(c) };
  } catch {
    return null;
  }
}

/**
 * The inbox half of the stored settings, or null when there is none or it can't
 * be used: no host, a port outside IMAP_PORTS or an unknown security.
 */
function openImapSettings(c: Credentials): ImapSettings | null {
  // Compared as text, so only the exact "993" or "143" matches.
  const port = IMAP_PORTS.find((p) => String(p) === c.imapPort);
  const security = c.imapSecurity === "ssl" || c.imapSecurity === "starttls" ? c.imapSecurity : null;
  if (!c.imapHost || port === undefined || security === null) return null;
  return { host: c.imapHost, port, security };
}
