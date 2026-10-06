import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { emailComposerData } from "@/lib/queries/email-broadcasts";
import { EMPTY_AUDIENCE } from "@/lib/validations/email-broadcast";
import { EmailComposer } from "@/components/email/email-composer";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const data = await emailComposerData(ctx.organizationId);

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
        <p className="mt-1 text-muted-foreground">{t("composerSubtitle")}</p>
      </div>
      <EmailComposer
        draft={{
          id: null,
          subject: "",
          html: "",
          fromName: ctx.organization.name,
          replyTo: "",
          audience: EMPTY_AUDIENCE,
          picked: [],
        }}
        options={data.options}
        fromEmail={data.fromEmail}
        userEmail={ctx.user.email}
        quota={data.quota}
      />
    </div>
  );
}
