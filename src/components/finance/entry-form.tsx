"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { usePrompt } from "@/components/ui/prompt";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { createEntry, updateEntry, createFinanceCategory } from "@/app/actions/finance";

type Opt = { id: string; name: string };
type Category = { id: string; name: string; type: "INCOME" | "EXPENSE" };

export type EntryDefaults = {
  type: "INCOME" | "EXPENSE";
  description: string;
  amount: number;
  status: "PENDING" | "SETTLED";
  dueDate: string; // yyyy-mm-dd
  settledAt: string;
  method: string;
  categoryId: string;
  contactId: string;
  companyId: string;
  opportunityId: string;
  notes: string;
};

const METHODS = ["PIX", "BOLETO", "CARD", "CASH", "TRANSFER", "OTHER"] as const;

const selectCls = cn(
  "h-[42px] w-full rounded-lg border border-border bg-card px-3 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

export function EntryForm({
  mode,
  entryId,
  defaults,
  options,
}: {
  mode: "create" | "edit";
  entryId?: string;
  defaults: EntryDefaults;
  options: {
    contacts: Opt[];
    companies: Opt[];
    opportunities: { id: string; title: string }[];
    categories: Category[];
  };
}) {
  const t = useTranslations("finance");
  const router = useRouter();
  const prompt = usePrompt();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState(defaults.type);
  const [status, setStatus] = useState(defaults.status);
  const [categoryId, setCategoryId] = useState(defaults.categoryId);
  const [categories, setCategories] = useState(options.categories);

  const typeCategories = categories.filter((c) => c.type === type);

  async function onNewCategory() {
    const name = await prompt({ title: t("newCategory"), placeholder: t("categoryName") });
    if (!name) return;
    const r = await createFinanceCategory(name, type);
    if (r.ok && r.id) {
      setCategories((prev) => [...prev, { id: r.id!, name, type }]);
      setCategoryId(r.id);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = mode === "create" ? await createEntry(fd) : await updateEntry(entryId!, fd);
      if (r.ok) {
        router.push("/app/finance/entries");
        router.refresh();
      } else {
        setError(t(`error.${r.error}`));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-5">
      {/* Type toggle */}
      <input type="hidden" name="type" value={type} />
      <div className="flex gap-2">
        {(["INCOME", "EXPENSE"] as const).map((ty) => (
          <button
            key={ty}
            type="button"
            onClick={() => {
              setType(ty);
              setCategoryId("");
            }}
            className={cn(
              "flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
              type === ty
                ? ty === "INCOME"
                  ? "border-green-500 bg-green-500/10 text-green-600"
                  : "border-red-500 bg-red-500/10 text-red-600"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {t(`type.${ty}`)}
          </button>
        ))}
      </div>

      <div>
        <Label htmlFor="description">{t("field.description")}</Label>
        <Input id="description" name="description" defaultValue={defaults.description} required maxLength={200} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="amount">{t("field.amount")}</Label>
          <MoneyInput id="amount" name="amount" defaultValue={defaults.amount} required />
        </div>
        <div>
          <Label htmlFor="dueDate">{t("field.dueDate")}</Label>
          <Input id="dueDate" name="dueDate" type="date" defaultValue={defaults.dueDate} required />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="status">{t("field.status")}</Label>
          <select
            id="status"
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "PENDING" | "SETTLED")}
            className={selectCls}
          >
            <option value="PENDING">{t(`status.PENDING.${type}`)}</option>
            <option value="SETTLED">{t(`status.SETTLED.${type}`)}</option>
          </select>
        </div>
        {status === "SETTLED" ? (
          <div>
            <Label htmlFor="settledAt">{t("field.settledAt")}</Label>
            <Input id="settledAt" name="settledAt" type="date" defaultValue={defaults.settledAt} />
          </div>
        ) : (
          <input type="hidden" name="settledAt" value="" />
        )}
      </div>

      {mode === "create" && status === "PENDING" ? (
        <div>
          <Label htmlFor="installments">{t("field.installments")}</Label>
          <Input id="installments" name="installments" type="number" min="1" max="120" defaultValue="1" className="sm:max-w-40" />
          <p className="mt-1 text-xs text-muted-foreground">{t("installmentsHint")}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="categoryId">{t("field.category")}</Label>
            <button
              type="button"
              onClick={onNewCategory}
              className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
            >
              <Plus className="size-3" />
              {t("newCategory")}
            </button>
          </div>
          <select
            id="categoryId"
            name="categoryId"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={selectCls}
          >
            <option value="">{t("uncategorized")}</option>
            {typeCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="method">{t("field.method")}</Label>
          <select id="method" name="method" defaultValue={defaults.method} className={selectCls}>
            <option value="">{t("noMethod")}</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>{t(`method.${m}`)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* CRM links */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="contactId">{t("field.contact")}</Label>
          <select id="contactId" name="contactId" defaultValue={defaults.contactId} className={selectCls}>
            <option value="">—</option>
            {options.contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="companyId">{t("field.company")}</Label>
          <select id="companyId" name="companyId" defaultValue={defaults.companyId} className={selectCls}>
            <option value="">—</option>
            {options.companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="opportunityId">{t("field.opportunity")}</Label>
          <select id="opportunityId" name="opportunityId" defaultValue={defaults.opportunityId} className={selectCls}>
            <option value="">—</option>
            {options.opportunities.map((o) => (
              <option key={o.id} value={o.id}>{o.title}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="notes">{t("field.notes")}</Label>
        <Textarea id="notes" name="notes" defaultValue={defaults.notes} rows={3} maxLength={2000} />
      </div>

      {error ? <p role="alert" className="text-sm text-red-500">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
