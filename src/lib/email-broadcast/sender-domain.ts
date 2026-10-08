import { isValidEmail, normalizeEmail } from "./normalize";

/**
 * Sender-domain rules of the mass e-mail: every org sends through the
 * PLATFORM's Resend account, so the From domain must be one the platform team
 * verified and assigned to that org (EmailSenderDomain). Pure and free of
 * `server-only`: the composer, the server and scripts/ all use it.
 */

/** The platform's own sending domain — never assignable to a client org. */
export const PLATFORM_DOMAIN = "metodotia.com";

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** Canonical form of a domain typed by an admin, or null when it isn't one. */
export function normalizeDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
  return domain.length <= 253 && DOMAIN_RE.test(domain) ? domain : null;
}

/** Normalized domain of a valid e-mail address, or null. */
export function domainOfEmail(email: string): string | null {
  const normalized = normalizeEmail(email);
  return isValidEmail(normalized) ? normalized.slice(normalized.lastIndexOf("@") + 1) : null;
}

export function isPlatformDomain(domain: string): boolean {
  return domain === PLATFORM_DOMAIN || domain.endsWith(`.${PLATFORM_DOMAIN}`);
}

/** True when the address' exact domain is one of the org's allowed domains
 * (subdomains don't inherit) and it isn't the platform's. */
export function isSenderAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = domainOfEmail(email);
  return domain !== null && !isPlatformDomain(domain) && allowedDomains.includes(domain);
}
