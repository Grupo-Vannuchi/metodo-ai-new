import { z } from "zod";
import { LIMITS } from "@/config/limits";
import { IMAP_PORTS, defaultImapSecurity, type ImapPort } from "@/lib/email-broadcast/imap/core";
import { isValidEmail } from "@/lib/email-broadcast/normalize";
import { SMTP_PORTS, type SmtpPort } from "@/lib/email-broadcast/smtp/core";

// A DNS name with at least one dot whose last label starts with a letter (so "smtp.25" isn't one), or an IPv4
// literal. Nothing else: a pasted "smtp://host:587" or "host/path" has ":", "/" or spaces and fails here.
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const HOST_IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * SMTP account form payload (spec 2026-10-21, 4.1). The password may be empty
 * here: the action decides whether that means "keep the saved one" or "missing".
 * The host is only checked for shape; where it resolves to is checked on every
 * connection (smtp/address.ts).
 *
 * The inbox (spec 2026-10-23) is optional and comes as `imapHost` and `imapPort`:
 * a blank or missing host is no inbox, and the output holds it as `imap`, null
 * or { host, port, security } with the security the port implies (993 is TLS
 * from the start, 143 is STARTTLS). A host with no port is the usual 993. The
 * user and the password are the SMTP account's own, so the form has no field
 * for them.
 */
export const smtpAccountSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).refine(isValidEmail, "invalid_email"),
    displayName: z.string().trim().max(100).nullish(),
    host: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .refine((host) => HOST_NAME.test(host) || HOST_IPV4.test(host), "invalid_host"),
    port: z.coerce
      .number()
      .int()
      .refine((port): port is SmtpPort => (SMTP_PORTS as readonly number[]).includes(port), "invalid_port"),
    security: z.enum(["ssl", "starttls"]),
    username: z.string().trim().max(254).nullish(),
    password: z.string().max(512),
    imapHost: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .refine((host) => host === "" || HOST_NAME.test(host) || HOST_IPV4.test(host), "invalid_imap_host")
      .optional(),
    imapPort: z.coerce
      .number()
      .int()
      .refine((port): port is ImapPort => (IMAP_PORTS as readonly number[]).includes(port), "invalid_imap_port")
      .optional(),
    hourlyLimit: z.coerce.number().int().min(1).max(LIMITS.smtpHourlyMax),
    dailyLimit: z.coerce.number().int().min(1).max(LIMITS.smtpDailyMax),
  })
  .refine((account) => account.hourlyLimit <= account.dailyLimit, {
    path: ["hourlyLimit"],
    message: "hourly_over_daily",
  })
  // An empty name is "no name", an empty user is the sender's address, and an empty inbox server is no inbox.
  .transform(({ imapHost, imapPort, ...account }) => {
    const port = imapPort ?? IMAP_PORTS[0];
    return {
      ...account,
      displayName: account.displayName || null,
      username: account.username || account.email,
      imap: imapHost ? { host: imapHost, port, security: defaultImapSecurity(port) } : null,
    };
  });

export type SmtpAccountInput = z.input<typeof smtpAccountSchema>;
export type SmtpAccountData = z.output<typeof smtpAccountSchema>;
