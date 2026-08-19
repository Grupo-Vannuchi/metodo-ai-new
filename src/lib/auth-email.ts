import "server-only";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/send";
import { issueAuthToken, VERIFY_TTL_MS } from "@/lib/auth-tokens";
import { renderVerificationEmail, renderWelcomeEmail, renderEmailChangeEmail } from "@/lib/email/templates";

/** Issue a verification token and send the confirm-your-email link. */
export async function sendVerificationEmail(
  userId: string,
  name: string,
  email: string,
): Promise<boolean> {
  const token = await issueAuthToken(userId, "EMAIL_VERIFICATION", VERIFY_TTL_MS);
  const { subject, html } = renderVerificationEmail({
    name,
    verifyUrl: `${env.NEXT_PUBLIC_SITE_URL}/verify/${token}`,
  });
  return (await sendEmail({ to: email, subject, html })).ok;
}

/** Issue an EMAIL_CHANGE token and send the confirmation link to the NEW address
 *  (double opt-in). The e-mail is only applied once this link is confirmed. */
export async function sendEmailChangeVerification(
  userId: string,
  name: string,
  newEmail: string,
): Promise<boolean> {
  const token = await issueAuthToken(userId, "EMAIL_CHANGE", VERIFY_TTL_MS);
  const { subject, html } = renderEmailChangeEmail({
    name,
    newEmail,
    confirmUrl: `${env.NEXT_PUBLIC_SITE_URL}/verify-email/${token}`,
  });
  return (await sendEmail({ to: newEmail, subject, html })).ok;
}

/** Send the welcome email once the account is verified (best-effort). */
export async function sendWelcomeEmail(name: string, email: string): Promise<void> {
  const { subject, html } = renderWelcomeEmail({ name, appUrl: `${env.NEXT_PUBLIC_SITE_URL}/app` });
  await sendEmail({ to: email, subject, html });
}
