import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { emailComposerData } from "@/lib/queries/email-broadcasts";
import { EMPTY_AUDIENCE } from "@/lib/validations/email-broadcast";
import { EmailComposer } from "@/components/email/email-composer";
import { ChannelChoice } from "@/components/email/channel-choice";
import { LIMITS } from "@/config/limits";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const CONNECT_ERRORS = ["cancelled", "admin_required", "not_configured", "failed"] as const;
type ConnectError = (typeof CONNECT_ERRORS)[number];

export default async function NewEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ via?: string; microsoft?: string; microsoft_error?: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const sp = await searchParams;
  const data = await emailComposerData(ctx.organizationId);

  // Without the Microsoft app configured there is nothing to choose: straight to the platform composer.
  const via = !data.microsoftConfigured ? "platform" : sp.via === "platform" || sp.via === "microsoft" ? sp.via : null;
  if (via === "microsoft" && data.microsoft?.status !== "ACTIVE") redirect({ href: "/app/email/new", locale });
  const error = (CONNECT_ERRORS as readonly string[]).includes(sp.microsoft_error ?? "")
    ? (sp.microsoft_error as ConnectError)
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/email" className="hover:underline">
            {t("title")}
          </Link>{" "}
          / {t("newTitle")}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
        {via ? <p className="mt-1 text-muted-foreground">{t("composerSubtitle")}</p> : null}
      </div>
      {via === null ? (
        <ChannelChoice
          account={data.microsoft}
          quotaLimit={LIMITS.emailBroadcastQuotaPerMonth}
          connected={sp.microsoft === "connected"}
          error={error}
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
            channel: via === "microsoft" ? "MICROSOFT" : "PLATFORM",
          }}
          options={data.options}
          allowedDomains={data.allowedDomains}
          quota={data.quota}
          signatures={data.signatures}
          microsoft={data.microsoft}
        />
      )}
    </div>
  );
}
