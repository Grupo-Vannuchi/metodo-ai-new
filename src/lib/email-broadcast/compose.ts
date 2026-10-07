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

export type ComposedEmail = { subject: string; html: string; text: string };

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
