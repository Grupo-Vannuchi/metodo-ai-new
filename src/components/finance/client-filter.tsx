"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Opt = { id: string; name: string };

/** Filter a finance report by a CRM client (contact or company). Encodes the
 * selection as "c:<id>" / "e:<id>" and navigates, preserving `keep` params. */
export function ClientFilter({
  contacts,
  companies,
  value,
  basePath,
  keep = {},
}: {
  contacts: Opt[];
  companies: Opt[];
  value: string;
  basePath: string;
  keep?: Record<string, string>;
}) {
  const t = useTranslations("finance");
  const router = useRouter();

  function go(v: string) {
    const p = new URLSearchParams(keep);
    if (v.startsWith("c:")) p.set("contactId", v.slice(2));
    else if (v.startsWith("e:")) p.set("companyId", v.slice(2));
    const qs = p.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <select
      value={value}
      onChange={(e) => go(e.target.value)}
      className={cn(
        "h-9 max-w-56 rounded-lg border border-border bg-card px-2.5 text-sm",
        "focus-visible:border-brand focus-visible:outline-none",
      )}
    >
      <option value="">{t("allClients")}</option>
      {companies.length > 0 ? (
        <optgroup label={t("companiesGroup")}>
          {companies.map((c) => (
            <option key={c.id} value={`e:${c.id}`}>{c.name}</option>
          ))}
        </optgroup>
      ) : null}
      {contacts.length > 0 ? (
        <optgroup label={t("contactsGroup")}>
          {contacts.map((c) => (
            <option key={c.id} value={`c:${c.id}`}>{c.name}</option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}
