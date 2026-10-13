import "server-only";
import { sanitizeHtml } from "@/lib/proposals/sanitize";
import {
  buildEmailDocument,
  fillHtmlVars,
  fillTextVars,
  htmlToText,
  prepareEmailImages,
  type TemplateVars,
} from "./render";
import { renderSignature, type SignatureContent } from "./signature";

export type ComposedEmail = { subject: string; html: string; text: string };

export type ComposedSignature = { html: string; text: string };

/**
 * A signature as it is shown and sent: rendered, run through the same
 * allowlist sanitizer as the body, with e-mail-safe images. This is the value
 * frozen on a send when it starts (spec 2026-10-13 §6).
 */
export function composeSignature(content: SignatureContent): ComposedSignature {
  const rendered = renderSignature(content);
  return { html: prepareEmailImages(sanitizeHtml(rendered.html)), text: rendered.text };
}

/**
 * Final subject/HTML/text for one recipient. The editor HTML goes through the
 * Proposals allowlist sanitizer first (reused, not modified), images are made
 * e-mail-safe, then the variables are filled with escaped values.
 */
export function composeEmail(input: {
  subject: string;
  bodyHtml: string;
  vars: TemplateVars;
  orgName: string;
  unsubscribeUrl: string;
}): ComposedEmail {
  const body = fillHtmlVars(prepareEmailImages(sanitizeHtml(input.bodyHtml)), input.vars);
  return {
    subject: fillTextVars(input.subject, input.vars),
    html: buildEmailDocument({ bodyHtml: body, orgName: input.orgName, unsubscribeUrl: input.unsubscribeUrl }),
    text: `${htmlToText(body)}\n\n--\nVocê recebeu este e-mail de ${input.orgName}. Para não receber mais: ${input.unsubscribeUrl}`,
  };
}
