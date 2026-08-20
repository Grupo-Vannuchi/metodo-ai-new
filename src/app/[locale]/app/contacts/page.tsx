import { getTranslations } from "next-intl/server";
import { requireOrgContext } from "@/lib/tenant";
import { getContactsBoard } from "@/lib/queries/contact-folders";
import { companyOptions } from "@/lib/queries/companies";
import { findContactDuplicates } from "@/lib/queries/duplicates";
import { ContactsGrid } from "@/components/crm/contacts-grid";
import { CsvImport } from "@/components/crm/csv-import";
import { DuplicatesModal } from "@/components/crm/duplicates-modal";
import { QuickCreateContact } from "@/components/crm/quick-create";
import { ExportButton } from "@/components/ui/export-button";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.contacts");

  const [{ columns }, dupes, companies] = await Promise.all([
    getContactsBoard(ctx.organizationId),
    findContactDuplicates(ctx.organizationId),
    companyOptions(ctx.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {dupes.length > 0 ? <DuplicatesModal entity="contacts" groups={dupes} /> : null}
          <CsvImport entity="contacts" />
          <ExportButton endpoint="/api/crm/export" params={{ entity: "contacts" }} label={t("export")} />
          <QuickCreateContact companies={companies} />
        </div>
      </div>

      <ContactsGrid columns={columns} />
    </div>
  );
}
