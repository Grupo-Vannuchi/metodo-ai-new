"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Contact, Mail, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchEmailTargets } from "@/app/actions/email-broadcasts";
import { isValidEmail, normalizeEmail, parseEmailList } from "@/lib/email-broadcast/normalize";
import type { AudienceSelection } from "@/lib/validations/email-broadcast";
import type { ComposerOptions, PickedTarget } from "@/lib/email-broadcast/types";

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        on ? "border-brand bg-brand/10 font-medium text-brand" : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Groups (contacts by tag/folder, companies by folder) + typed/searched addresses, all summed. */
export function RecipientPicker({
  options,
  audience,
  onAudienceChange,
  picked,
  onPickedChange,
}: {
  options: ComposerOptions;
  audience: AudienceSelection;
  onAudienceChange: (next: AudienceSelection) => void;
  picked: PickedTarget[];
  onPickedChange: (next: PickedTarget[]) => void;
}) {
  const t = useTranslations("emailBroadcast");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedTarget[]>([]);
  const set = (patch: Partial<AudienceSelection>) => onAudienceChange({ ...audience, ...patch });

  // Debounced search; state only changes inside the timeout.
  useEffect(() => {
    let active = true;
    const term = query.trim();
    const handle = setTimeout(async () => {
      const found = term.length >= 2 && !/[,;\s]/.test(term) ? await searchEmailTargets(term) : [];
      if (active) setResults(found);
    }, 250);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query]);

  function addEmails(text: string) {
    const parsed = parseEmailList(text);
    if (parsed.length === 0) return;
    const next = [...audience.emails];
    for (const email of parsed) if (!next.includes(email)) next.push(email);
    set({ emails: next });
    setQuery("");
  }

  function pick(target: PickedTarget) {
    if (!picked.some((p) => p.kind === target.kind && p.id === target.id)) onPickedChange([...picked, target]);
    if (target.kind === "contact") {
      if (!audience.contactIds.includes(target.id)) set({ contactIds: [...audience.contactIds, target.id] });
    } else if (!audience.companyIds.includes(target.id)) {
      set({ companyIds: [...audience.companyIds, target.id] });
    }
    setQuery("");
    setResults([]);
  }

  function unpick(target: PickedTarget) {
    onPickedChange(picked.filter((p) => !(p.kind === target.kind && p.id === target.id)));
    if (target.kind === "contact") set({ contactIds: audience.contactIds.filter((x) => x !== target.id) });
    else set({ companyIds: audience.companyIds.filter((x) => x !== target.id) });
  }

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="text-sm font-semibold">{t("recipients")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("recipientsHint")}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Contact className="size-4 text-brand" />
          {t("contacts")}
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={audience.allContacts}
            onChange={(e) => set({ allContacts: e.target.checked })}
          />
          <span className="flex-1">{t("allContacts")}</span>
          <span className="tabular-nums text-muted-foreground">{options.contactCount}</span>
        </label>
        {options.tags.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">{t("byTag")}</p>
            <div className="flex flex-wrap gap-2">
              {options.tags.map((tag) => (
                <Chip
                  key={tag.name}
                  on={audience.contactTags.includes(tag.name)}
                  onClick={() => set({ contactTags: toggle(audience.contactTags, tag.name) })}
                >
                  {tag.name} · {tag.count}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
        {options.contactFolders.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">{t("byFolder")}</p>
            <div className="flex flex-wrap gap-2">
              {options.contactFolders.map((f) => (
                <Chip
                  key={f.id}
                  on={audience.contactFolderIds.includes(f.id)}
                  onClick={() => set({ contactFolderIds: toggle(audience.contactFolderIds, f.id) })}
                >
                  {f.name} · {f.count}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <hr className="border-border" />

      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-brand" />
          {t("companies")}
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-brand"
            checked={audience.allCompanies}
            onChange={(e) => set({ allCompanies: e.target.checked })}
          />
          <span className="flex-1">{t("allCompanies")}</span>
          <span className="tabular-nums text-muted-foreground">{options.companyCount}</span>
        </label>
        {options.companyFolders.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">{t("byFolder")}</p>
            <div className="flex flex-wrap gap-2">
              {options.companyFolders.map((f) => (
                <Chip
                  key={f.id}
                  on={audience.companyFolderIds.includes(f.id)}
                  onClick={() => set({ companyFolderIds: toggle(audience.companyFolderIds, f.id) })}
                >
                  {f.name} · {f.count}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <hr className="border-border" />

      <div className="flex flex-col gap-2">
        <label htmlFor="manual-emails" className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="size-4 text-brand" />
          {t("manual")}
        </label>
        <div className="relative">
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-card p-2 focus-within:border-brand">
            {picked.map((p) => (
              <span
                key={`${p.kind}:${p.id}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted py-1 pl-3 pr-1 text-sm"
              >
                {p.kind === "company" ? <Building2 className="size-3.5 shrink-0" /> : null}
                <span className="font-medium">{p.name}</span>
                <span className="truncate text-muted-foreground">{p.email}</span>
                <button
                  type="button"
                  aria-label={t("remove", { email: p.email })}
                  onClick={() => unpick(p)}
                  className="rounded-full p-0.5 hover:bg-background"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            {audience.emails.map((email) => {
              const valid = isValidEmail(normalizeEmail(email));
              return (
                <span
                  key={email}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-sm",
                    valid
                      ? "bg-muted"
                      : "border border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
                  )}
                >
                  <span className="truncate">{email}</span>
                  {valid ? null : <span className="text-xs">{t("invalidChip")}</span>}
                  <button
                    type="button"
                    aria-label={t("remove", { email })}
                    onClick={() => set({ emails: audience.emails.filter((e) => e !== email) })}
                    className="rounded-full p-0.5 hover:bg-background"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              );
            })}
            <input
              id="manual-emails"
              value={query}
              placeholder={t("manualPlaceholder")}
              autoComplete="off"
              className="min-w-40 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && query.includes("@")) {
                  e.preventDefault();
                  addEmails(query);
                } else if (e.key === "Enter" && results[0]) {
                  e.preventDefault();
                  pick(results[0]);
                }
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (text.includes("@")) {
                  e.preventDefault();
                  addEmails(text);
                }
              }}
              onBlur={() => {
                if (query.includes("@")) addEmails(query);
              }}
            />
          </div>
          {results.length > 0 ? (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              {results.map((r) => (
                <li key={`${r.kind}:${r.id}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(r)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {r.kind === "company" ? (
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Contact className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-medium">{r.name}</span>
                    <span className="truncate text-muted-foreground">{r.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("manualHint")}</p>
      </div>
    </section>
  );
}
