import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getContact } from "@/lib/queries/contacts";
import { companyOptions as companiesList } from "@/lib/queries/companies";
import { ContactForm } from "@/components/crm/contact-form";
import { contactToForm } from "@/lib/contact-form";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.contacts");

  const [contact, companies] = await Promise.all([
    getContact(ctx.organizationId, id),
    companiesList(ctx.organizationId),
  ]);
  if (!contact) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("editTitle")}</h1>
      <ContactForm
        mode="edit"
        contactId={contact.id}
        defaultValues={contactToForm(contact)}
        companies={companies}
      />
    </div>
  );
}
