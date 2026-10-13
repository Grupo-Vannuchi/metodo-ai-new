import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { listSignatureOptions } from "@/lib/queries/email-signatures";
import { MAX_SIGNATURES } from "@/lib/email-broadcast/signature";
import { EmailTabs } from "@/components/email/email-tabs";
import { SignatureCard } from "@/components/email/signature-card";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** E-mail → Assinaturas (spec 2026-10-13 §4.2). The E-mail layout already
 * requires the "email" screen and the Marketing module. */
export default async function EmailSignaturesPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("emailBroadcast");
  const signatures = await listSignatureOptions(ctx.organizationId);
  const atLimit = signatures.length >= MAX_SIGNATURES;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        {!atLimit ? (
          <Link href="/app/email/signatures/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("signatures.new")}
          </Link>
        ) : null}
      </div>

      <EmailTabs active="signatures" />

      <p className="max-w-3xl text-sm text-muted-foreground">{t("signatures.intro")}</p>
      {atLimit ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t("signatures.limit")}
        </p>
      ) : null}

      {signatures.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center">
          <p className="font-semibold">{t("signatures.emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("signatures.emptyBody")}</p>
          <Link href="/app/email/signatures/new" className={buttonVariants()}>
            <Plus className="size-4" />
            {t("signatures.createFirst")}
          </Link>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {signatures.map((s) => (
            <SignatureCard key={s.id} signature={s} />
          ))}
          {!atLimit ? (
            <Link
              href="/app/email/signatures/new"
              className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center text-muted-foreground transition-colors hover:border-brand hover:text-brand"
            >
              <Plus className="size-6" />
              <span className="text-sm font-semibold">{t("signatures.new")}</span>
              <span className="text-sm">{t("signatures.newHint")}</span>
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
