import { z } from "zod";
import { isValidEmail, normalizeEmail } from "@/lib/email-broadcast/normalize";
import type { AudienceStats } from "@/lib/email-broadcast/audience-core";

const id = z.string().min(1).max(64);

/** Who receives a send: the UNION of every criterion. Stored as JSON on the draft. */
export const audienceSelectionSchema = z.object({
  allContacts: z.boolean().default(false),
  contactTags: z.array(z.string().min(1).max(100)).max(200).default([]),
  contactFolderIds: z.array(id).max(200).default([]),
  contactIds: z.array(id).max(1000).default([]),
  allCompanies: z.boolean().default(false),
  companyFolderIds: z.array(id).max(200).default([]),
  companyIds: z.array(id).max(1000).default([]),
  emails: z.array(z.string().max(320)).max(5000).default([]),
});

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
};

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
