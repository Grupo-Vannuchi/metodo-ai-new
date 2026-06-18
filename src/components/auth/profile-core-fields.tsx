"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { formatDocument, type DocumentType } from "@/lib/document";
import { formatBrPhone } from "@/lib/phone";

/**
 * Phone + CPF/CNPJ fields captured when an account is created. Masks the inputs
 * as the user types; the server normalizes to digits and validates. Submits via
 * the surrounding `<form>` (FormData) — no react-hook-form here.
 */
export function ProfileCoreFields({
  defaults,
}: {
  defaults?: { phone?: string; documentType?: DocumentType; document?: string };
}) {
  const t = useTranslations("profile");
  const [docType, setDocType] = useState<DocumentType>(defaults?.documentType ?? "CPF");
  const [doc, setDoc] = useState(
    defaults?.document ? formatDocument(defaults.documentType ?? "CPF", defaults.document) : "",
  );
  const [phone, setPhone] = useState(defaults?.phone ? formatBrPhone(defaults.phone) : "");

  return (
    <>
      <div>
        <Label htmlFor="phone">{t("phone")}</Label>
        <Input
          id="phone"
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 91234-5678"
          value={phone}
          onChange={(e) => setPhone(formatBrPhone(e.target.value))}
          required
        />
      </div>

      <div className="flex gap-3">
        <div>
          <Label htmlFor="documentType">{t("documentType")}</Label>
          <select
            id="documentType"
            name="documentType"
            value={docType}
            onChange={(e) => {
              const v = e.target.value as DocumentType;
              setDocType(v);
              setDoc(formatDocument(v, doc));
            }}
            className={cn(
              "h-[42px] rounded-lg border border-border bg-card px-3 text-sm",
              "focus-visible:border-brand focus-visible:outline-none",
            )}
          >
            <option value="CPF">CPF</option>
            <option value="CNPJ">CNPJ</option>
          </select>
        </div>
        <div className="flex-1">
          <Label htmlFor="document">{docType === "CPF" ? t("cpf") : t("cnpj")}</Label>
          <Input
            id="document"
            name="document"
            inputMode="numeric"
            value={doc}
            placeholder={docType === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"}
            onChange={(e) => setDoc(formatDocument(docType, e.target.value))}
            required
          />
        </div>
      </div>
    </>
  );
}
