import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getContactsBoard } from "@/lib/queries/contact-folders";
import { ContactsGrid } from "@/components/crm/contacts-grid";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
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

  const { columns } = await getContactsBoard(ctx.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Link href="/app/contacts/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("new")}
        </Link>
      </div>

      <ContactsGrid columns={columns} />
    </div>
  );
}
