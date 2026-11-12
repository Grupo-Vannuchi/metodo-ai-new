import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { listEmailSignatures } from "@/lib/queries/email-signatures";
import { MAX_SIGNATURES } from "@/lib/email-broadcast/signature";
import { SignatureForm } from "@/components/email/signature-form";
import { Link, redirect } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewEmailSignaturePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const existing = await listEmailSignatures(ctx.organizationId);
  if (existing.length >= MAX_SIGNATURES) redirect({ href: "/app/email/signatures", locale });

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
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t("signatures.form.newTitle")}</h1>
      </div>
      <SignatureForm
        initial={{
          id: null,
          name: "",
          kind: "TEXT",
          html: "",
          imageUrl: "",
          imageAlt: "",
          imageHref: "",
          // The company's first default comes pre-checked.
          isDefault: !existing.some((s) => s.isDefault),
        }}
      />
    </div>
  );
}
