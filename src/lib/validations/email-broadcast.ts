import { z } from "zod";
import { isValidEmail, normalizeEmail } from "@/lib/email-broadcast/normalize";
import { MAX_ATTACHMENTS } from "@/lib/email-broadcast/attachments";
import type { AudienceStats } from "@/lib/email-broadcast/audience-core";
import {
  MAX_AUDIENCE_EMAILS,
  MAX_IMPORTS,
  MAX_IMPORT_NAME,
  audienceEmailCount,
} from "@/lib/email-broadcast/spreadsheet";

const id = z.string().min(1).max(64);
const emailList = z.array(z.string().max(320)).max(MAX_AUDIENCE_EMAILS);

/** Who receives a send: the UNION of every criterion. Stored as JSON on the draft. */
export const audienceSelectionSchema = z
  .object({
    allContacts: z.boolean().default(false),
    contactTags: z.array(z.string().min(1).max(100)).max(200).default([]),
    contactFolderIds: z.array(id).max(200).default([]),
    contactIds: z.array(id).max(1000).default([]),
    allCompanies: z.boolean().default(false),
    companyFolderIds: z.array(id).max(200).default([]),
    companyIds: z.array(id).max(1000).default([]),
    emails: emailList.default([]),
    // One entry per imported spreadsheet; drafts saved before imports existed parse with [].
    imports: z
      .array(z.object({ fileName: z.string().trim().min(1).max(MAX_IMPORT_NAME), emails: emailList }))
      .max(MAX_IMPORTS)
      .default([]),
  })
  .refine((sel) => audienceEmailCount(sel) <= MAX_AUDIENCE_EMAILS, "too_many_emails");

export type AudienceSelection = z.infer<typeof audienceSelectionSchema>;

export const EMPTY_AUDIENCE: AudienceSelection = {
  allContacts: false,
  contactTags: [],
  contactFolderIds: [],
  contactIds: [],
  allCompanies: false,
  companyFolderIds: [],
  companyIds: [],
  emails: [],
  imports: [],
};

/** One uploaded attachment as the composer sends it back; the server checks
 * the key, name and total again with checkAttachments. */
export const emailAttachmentSchema = z.object({
  key: z.string().min(1).max(300),
  filename: z.string().min(1).max(150),
  size: z.number().int().positive(),
});

export const broadcastDraftSchema = z.object({
  subject: z.string().trim().max(200),
  html: z.string().max(200_000),
  fromName: z.string().trim().max(100),
  fromEmail: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || isValidEmail(normalizeEmail(v)), "invalid_from"),
  replyTo: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || isValidEmail(normalizeEmail(v)), "invalid_reply_to"),
  audience: audienceSelectionSchema,
  attachments: z.array(emailAttachmentSchema).max(MAX_ATTACHMENTS).default([]),
  signatureId: z.string().min(1).max(64).nullable().default(null),
  channel: z.enum(["PLATFORM", "MICROSOFT", "GOOGLE", "SMTP"]).default("PLATFORM"),
});

export type BroadcastDraftInput = z.input<typeof broadcastDraftSchema>;

/** Stored `audience` JSON back into a selection (a broken row falls back to empty). */
export function readAudience(value: unknown): AudienceSelection {
  const parsed = audienceSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_AUDIENCE;
}

/** Stored `stats` JSON back into numbers (missing → 0). */
export function readStats(value: unknown): AudienceStats {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : 0);
  return { selected: n("selected"), invalid: n("invalid"), duplicates: n("duplicates"), suppressed: n("suppressed"), total: n("total") };
}
