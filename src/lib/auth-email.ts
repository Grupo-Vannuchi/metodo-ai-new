import "server-only";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/send";
import { issueAuthToken, VERIFY_TTL_MS } from "@/lib/auth-tokens";
import { renderVerificationEmail, renderWelcomeEmail } from "@/lib/email/templates";

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

/** Send the welcome email once the account is verified (best-effort). */
export async function sendWelcomeEmail(name: string, email: string): Promise<void> {
  const { subject, html } = renderWelcomeEmail({ name, appUrl: `${env.NEXT_PUBLIC_SITE_URL}/app` });
  await sendEmail({ to: email, subject, html });
}
