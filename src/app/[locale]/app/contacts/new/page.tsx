import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { companyOptions } from "@/lib/queries/companies";
import { ContactForm } from "@/components/crm/contact-form";
import { emptyContactForm } from "@/lib/contact-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function NewContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  /** Optional prefill, e.g. "Adicionar ao CRM" from the e-mail inbox. */
  searchParams: Promise<{ name?: string | string[]; email?: string | string[] }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.contacts");

  const companies = await companyOptions(ctx.organizationId);
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim().slice(0, 200) ?? "";
  const defaults = { ...emptyContactForm(), name: first(sp.name), email: first(sp.email) };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("newTitle")}</h1>
      <ContactForm mode="create" defaultValues={defaults} companies={companies} />
    </div>
  );
}
