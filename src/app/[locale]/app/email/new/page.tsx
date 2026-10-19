import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { emailComposerData } from "@/lib/queries/email-broadcasts";
import { EMPTY_AUDIENCE } from "@/lib/validations/email-broadcast";
import { EmailComposer } from "@/components/email/email-composer";
import { ChannelChoice, type ChannelNotice } from "@/components/email/channel-choice";
import { emailListHref, type ListChannel } from "@/lib/email-broadcast/list-channel";
import type { GoogleConnectError } from "@/lib/email-broadcast/google/core";
import type { MicrosoftConnectError } from "@/lib/email-broadcast/microsoft/core";
import { LIMITS } from "@/config/limits";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

// Closed lists: only these codes from the callback's query string reach the toast.
const MICROSOFT_CONNECT_ERRORS: readonly MicrosoftConnectError[] = ["cancelled", "admin_required", "not_configured", "failed"];
const GOOGLE_CONNECT_ERRORS: readonly GoogleConnectError[] = [
  "cancelled",
  "admin_required",
  "missing_send",
  "no_gmail",
  "not_configured",
  "failed",
];

const VIA_CHANNEL: Record<"platform" | "microsoft" | "google", ListChannel> = {
  platform: "plataforma",
  microsoft: "microsoft",
  google: "google",
};

export default async function NewEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    via?: string;
    microsoft?: string;
    microsoft_error?: string;
    google?: string;
    google_error?: string;
  }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const sp = await searchParams;
  const data = await emailComposerData(ctx.organizationId);
  const microsoftEnabled = data.microsoftConfigured;
  const googleEnabled = data.googleEnabled;

  // With no mailbox channel enabled there is nothing to choose: straight to the platform composer.
  // A mailbox channel that isn't enabled (not configured, or outside the pilot) asks again.
  const via: "platform" | "microsoft" | "google" | null =
    !microsoftEnabled && !googleEnabled
      ? "platform"
      : sp.via === "platform"
        ? "platform"
        : sp.via === "microsoft" && microsoftEnabled
          ? "microsoft"
          : sp.via === "google" && googleEnabled
            ? "google"
            : null;
  if (via === "microsoft" && data.microsoft?.status !== "ACTIVE") redirect({ href: "/app/email/new", locale });
  if (via === "google" && data.google?.status !== "ACTIVE") redirect({ href: "/app/email/new", locale });

  const microsoftError = MICROSOFT_CONNECT_ERRORS.find((e) => e === sp.microsoft_error) ?? null;
  const googleError = GOOGLE_CONNECT_ERRORS.find((e) => e === sp.google_error) ?? null;
  const notice: ChannelNotice | null =
    sp.microsoft === "connected" || microsoftError
      ? { provider: "MICROSOFT", connected: sp.microsoft === "connected", error: microsoftError }
      : sp.google === "connected" || googleError
        ? { provider: "GOOGLE", connected: sp.google === "connected", error: googleError }
        : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href={emailListHref(via ? VIA_CHANNEL[via] : null)} className="hover:underline">
            {t("title")}
          </Link>{" "}
          / {t("newTitle")}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
        {via ? <p className="mt-1 text-muted-foreground">{t("composerSubtitle")}</p> : null}
      </div>
      {via === null ? (
        <ChannelChoice
          microsoft={data.microsoft}
          microsoftEnabled={microsoftEnabled}
          google={data.google}
          googleEnabled={googleEnabled}
          quotaLimit={LIMITS.emailBroadcastQuotaPerMonth}
          notice={notice}
        />
      ) : (
        <EmailComposer
          draft={{
            id: null,
            subject: "",
            html: "",
            fromName: ctx.organization.name,
            fromEmail: "",
            replyTo: "",
            audience: EMPTY_AUDIENCE,
            picked: [],
            attachments: [],
            signatureId: data.signatures.find((s) => s.isDefault)?.id ?? null,
            channel: via === "microsoft" ? "MICROSOFT" : via === "google" ? "GOOGLE" : "PLATFORM",
          }}
          options={data.options}
          allowedDomains={data.allowedDomains}
          quota={data.quota}
          signatures={data.signatures}
          microsoft={data.microsoft}
          google={data.google}
        />
      )}
    </div>
  );
}
