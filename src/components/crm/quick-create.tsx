"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { CompanyForm } from "@/components/crm/company-form";
import { ContactForm } from "@/components/crm/contact-form";
import { emptyCompanyForm } from "@/lib/company-form";
import { emptyContactForm } from "@/lib/contact-form";

/** "Nova empresa" trigger that opens a slide-over with the company form (keeps
 *  CNPJ + CEP autofill) instead of navigating to a full page. */
export function QuickCreateCompany({ className }: { className?: string }) {
  const t = useTranslations("crm.companies");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonVariants(), className)}>
        <Plus className="size-4" />
        {t("new")}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t("newTitle")} description={t("subtitle")}>
        <CompanyForm
          mode="create"
          defaultValues={emptyCompanyForm()}
          onCreated={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </Drawer>
    </>
  );
}

/** "Novo contato" trigger that opens a slide-over with the contact form. */
export function QuickCreateContact({
  companies,
  className,
}: {
  companies: { id: string; name: string }[];
  className?: string;
}) {
  const t = useTranslations("crm.contacts");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonVariants(), className)}>
        <Plus className="size-4" />
        {t("new")}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t("newTitle")} description={t("subtitle")}>
        <ContactForm
          mode="create"
          defaultValues={emptyContactForm()}
          companies={companies}
          onCreated={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </Drawer>
    </>
  );
}
