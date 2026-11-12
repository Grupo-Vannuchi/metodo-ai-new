import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getEmailSignature } from "@/lib/queries/email-signatures";
import { SignatureForm } from "@/components/email/signature-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditEmailSignaturePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const s = await getEmailSignature(ctx.organizationId, id);
  if (!s) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/app/email" className="hover:underline">
            {t("title")}
          </Link>{" "}
          /{" "}
          <Link href="/app/email/signatures" className="hover:underline">
            {t("signatures.title")}
          </Link>{" "}
          / {s.name}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("signatures.form.editTitle")}</h1>
      </div>
      <SignatureForm
        initial={{
          id: s.id,
          name: s.name,
          kind: s.kind,
          html: s.html,
          imageUrl: s.imageUrl ?? "",
          imageAlt: s.imageAlt ?? "",
          imageHref: s.imageHref ?? "",
          isDefault: s.isDefault,
        }}
      />
    </div>
  );
}
