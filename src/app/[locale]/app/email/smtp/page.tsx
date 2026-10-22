import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getSmtpAccountForm } from "@/lib/queries/email-sender-accounts";
import { defaultSmtpSecurity } from "@/lib/email-broadcast/smtp/core";
import { SmtpAccountForm, type SmtpFormInitial, type SmtpFormMode } from "@/components/email/smtp-account-form";
import { LIMITS } from "@/config/limits";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/**
 * E-mail → Conta SMTP (spec 2026-10-21 §4.1 and §6): connect the company's SMTP
 * account, edit it, or give it its password again. The E-mail layout already
 * requires the "email" screen and the Marketing module, and the save action
 * checks both again. The saved password is never read here: the form is
 * filled with everything else and the password is typed.
 */
export default async function EmailSmtpPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const account = await getSmtpAccountForm(ctx.organizationId);

  // A NEEDS_RECONNECT account (the server refused its password, or its stored credentials no longer open) is
  // reconnected; the form opens with what is still known and asks for the rest.
  const mode: SmtpFormMode = !account ? "new" : account.status === "NEEDS_RECONNECT" ? "reconnect" : "edit";
  const initial: SmtpFormInitial = account
    ? {
        email: account.email,
        displayName: account.displayName ?? "",
        host: account.host,
        port: account.port,
        security: account.security,
        username: account.username,
        hourlyLimit: account.hourlyLimit,
        dailyLimit: account.dailyLimit,
      }
    : {
        email: "",
        displayName: "",
        host: "",
        port: 587,
        security: defaultSmtpSecurity(587),
        username: "",
        hourlyLimit: LIMITS.smtpHourlyDefault,
        dailyLimit: LIMITS.smtpDailyDefault,
      };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/email" className="hover:underline">
            {t("title")}
          </Link>{" "}
          / {t("smtp.title")}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {mode === "new" ? t("smtp.newTitle") : t("smtp.title")}
        </h1>
      </div>
      <SmtpAccountForm initial={initial} mode={mode} />
    </div>
  );
}
