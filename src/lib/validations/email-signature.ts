import { z } from "zod";
import { MAX_SIGNATURE_HTML, MAX_SIGNATURE_LINE, MAX_SIGNATURE_NAME } from "@/lib/email-broadcast/signature";

/** Signature form payload; signatureProblem (signature.ts) checks the content. */
export const emailSignatureSchema = z.object({
  name: z.string().trim().min(1).max(MAX_SIGNATURE_NAME),
  kind: z.enum(["TEXT", "IMAGE"]),
  html: z.string().max(MAX_SIGNATURE_HTML).default(""),
  imageUrl: z.string().trim().max(2000).default(""),
  imageAlt: z.string().trim().max(MAX_SIGNATURE_LINE).default(""),
  imageHref: z.string().trim().max(2000).default(""),
  isDefault: z.boolean().default(false),
});

export type EmailSignatureInput = z.input<typeof emailSignatureSchema>;
