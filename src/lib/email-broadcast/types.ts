import type { AudienceStats, CandidateSource } from "./audience-core";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";
import type { EmailAttachment } from "./attachments";

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
  sentLast24h: number;
  remaining: number;
};
