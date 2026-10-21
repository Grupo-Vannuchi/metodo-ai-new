import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { emailComposerData, getEmailBroadcast, pickedTargets } from "@/lib/queries/email-broadcasts";
import { readAudience } from "@/lib/validations/email-broadcast";
import { readAttachments } from "@/lib/email-broadcast/attachments";
import type { ComposerDraft } from "@/lib/email-broadcast/types";
import { EmailComposer } from "@/components/email/email-composer";
import { emailListHref, listChannelOf } from "@/lib/email-broadcast/list-channel";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditEmailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");

  const b = await getEmailBroadcast(ctx.organizationId, id);
  if (!b) notFound();
  if (b.status !== "DRAFT") redirect({ href: `/app/email/${id}`, locale });

  const audience = readAudience(b.audience);
  const [data, picked] = await Promise.all([
    emailComposerData(ctx.organizationId),
    pickedTargets(ctx.organizationId, audience.contactIds, audience.companyIds),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href={emailListHref(listChannelOf(b.channel))} className="hover:underline">
            {t("title")}
          </Link>{" "}
          / {t("editTitle")}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{b.subject || t("editTitle")}</h1>
        <p className="mt-1 text-muted-foreground">{t("composerSubtitle")}</p>
      </div>
      <EmailComposer
        draft={{
          id: b.id,
          subject: b.subject,
          html: b.html,
          fromName: b.fromName ?? "",
          fromEmail: b.fromEmail ?? "",
          replyTo: b.replyTo ?? "",
          audience,
          picked,
          attachments: readAttachments(b.attachments),
          signatureId: b.signatureId,
          // The stored channel now has SMTP, but nothing can save an SMTP draft until the send task adds it to
          // ComposerDraft.channel; from then on this assertion changes nothing.
          channel: b.channel as ComposerDraft["channel"],
        }}
        options={data.options}
        allowedDomains={data.allowedDomains}
        quota={data.quota}
        signatures={data.signatures}
        microsoft={data.microsoft}
        google={data.google}
      />
    </div>
  );
}
