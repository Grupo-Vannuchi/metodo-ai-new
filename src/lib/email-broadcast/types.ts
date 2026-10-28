import type { AudienceStats, CandidateSource } from "./audience-core";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";
import type { EmailAttachment } from "./attachments";
import type { ImapSettings } from "./imap/core";
import type { SmtpPort, SmtpSecurity } from "./smtp/core";

/** Shapes shared by the E-mail pages, actions and client components. Types only. */

export type PickedTarget = { kind: "contact" | "company"; id: string; name: string; email: string };

export type CountedOption = { id: string; name: string; count: number };

export type ComposerOptions = {
  contactCount: number;
  tags: { name: string; count: number }[];
  contactFolders: CountedOption[];
  companyCount: number;
  companyFolders: CountedOption[];
};

export type AudiencePreview = {
  stats: AudienceStats;
  invalidEmails: string[];
  sample: { email: string; name: string | null; sources: CandidateSource[] }[];
};

export type ComposerDraft = {
  id: string | null;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  audience: AudienceSelection;
  picked: PickedTarget[];
  attachments: EmailAttachment[];
  signatureId: string | null;
  channel: "PLATFORM" | "MICROSOFT" | "GOOGLE" | "SMTP";
};

/** A signature as the composer and the Assinaturas tab show it; previewHtml
 * is server-sanitized (composeSignature). */
export type SignatureOption = {
  id: string;
  name: string;
  kind: "TEXT" | "IMAGE";
  isDefault: boolean;
  updatedAt: string;
  previewHtml: string;
};

/** The org's sending account (Microsoft, Google or SMTP) as the screens show it (no credentials). */
export type SenderAccountView = {
  id: string;
  email: string;
  displayName: string | null;
  accountKind: "personal" | "work" | "smtp";
  status: "ACTIVE" | "NEEDS_RECONNECT";
  dailyLimit: number;
  /** Only the SMTP account has one (the company's own figure); null for Microsoft and Google. */
  hourlyLimit: number | null;
  /** The SMTP server's name, never its password; null for Microsoft and Google. */
  host: string | null;
  /** The IMAP server the inbox is read from (spec 2026-10-23); null for Microsoft and Google, and for an SMTP account that only sends. */
  imapHost: string | null;
  sentLast24h: number;
  remaining: number;
};

/** The SMTP account as its form is filled to edit or reconnect it: every field but the password, which never leaves the server. */
export type SmtpAccountFormView = {
  email: string;
  displayName: string | null;
  /** "" when the stored credentials can't be opened: the account then reads NEEDS_RECONNECT and the server is typed again. */
  host: string;
  port: SmtpPort;
  security: SmtpSecurity;
  /** "" for the same reason as `host`. */
  username: string;
  /** Where the inbox is read from; null when the account only sends (or the stored credentials can't be opened). */
  imap: ImapSettings | null;
  hourlyLimit: number;
  dailyLimit: number;
  status: "ACTIVE" | "NEEDS_RECONNECT";
};
