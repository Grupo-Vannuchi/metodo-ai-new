"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus, X, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { onlyDigits, formatCnpj } from "@/lib/cnpj";
import { createOpportunity } from "@/app/actions/opportunities";
import { createContact } from "@/app/actions/contacts";
import { createCompany, lookupCnpj } from "@/app/actions/companies";
import { createProductService } from "@/app/actions/product-services";

type Option = { id: string; name: string };
type ProductOption = { id: string; name: string; kind: "PRODUCT" | "SERVICE"; price: number | null };

type Values = {
  title: string;
  value: string;
  stageId: string;
  companyId: string;
  contactId: string;
  productServiceId: string;
  ownerId: string;
  expectedCloseDate: string;
  notes: string;
};

const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);
const miniCls = cn(
  "h-9 w-full rounded-md border border-border bg-card px-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

export function NewOpportunityForm({
  stages,
  companies,
  contacts,
  members,
  productServices,
  initialContactId,
  initialCompanyId,
  isMemberRole,
}: {
  stages: Option[];
  companies: Option[];
  contacts: Option[];
  members: Option[];
  productServices: ProductOption[];
  initialContactId?: string;
  initialCompanyId?: string;
  isMemberRole?: boolean;
}) {
  const t = useTranslations("crm.board");
  const tf = useTranslations("crm.opportunity");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  // Options are stateful so inline-created entities can be appended + selected
  // without leaving the form.
  const [companyOpts, setCompanyOpts] = useState(companies);
  const [contactOpts, setContactOpts] = useState(contacts);
  const [productOpts, setProductOpts] = useState(productServices);
  const [open, setOpen] = useState<null | "company" | "contact" | "product">(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [busy, startCreate] = useTransition();

  // Inline drafts.
  const [coName, setCoName] = useState("");
  const [coCnpj, setCoCnpj] = useState("");
  const [coExtra, setCoExtra] = useState<{ email?: string; phone?: string; street?: string; city?: string; uf?: string; zip?: string }>({});
  const [cnpjState, setCnpjState] = useState<"idle" | "loading" | "done" | "notFound" | "error">("idle");
  const [ctName, setCtName] = useState("");
  const [ctPhone, setCtPhone] = useState("");
  const [ctEmail, setCtEmail] = useState("");
  const [pName, setPName] = useState("");
  const [pKind, setPKind] = useState<"PRODUCT" | "SERVICE">("PRODUCT");
  const [pPrice, setPPrice] = useState("");

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: {
      title: "",
      value: "",
      stageId: stages[0]?.id ?? "",
      companyId: initialCompanyId ?? "",
      contactId: initialContactId ?? "",
      productServiceId: "",
      ownerId: isMemberRole && members.length > 0 ? members[0].id : "",
      expectedCloseDate: "",
      notes: "",
    },
  });

  function toggle(which: "company" | "contact" | "product") {
    setCreateErr(null);
    setOpen((cur) => (cur === which ? null : which));
  }

  async function runCnpjLookup() {
    const digits = onlyDigits(coCnpj);
    if (digits.length !== 14) return;
    setCnpjState("loading");
    const r = await lookupCnpj(digits);
    if (!r.ok) {
      setCnpjState(r.error === "notFound" ? "notFound" : "error");
      return;
    }
    setCoCnpj(formatCnpj(digits));
    if (!coName.trim() && r.data.name) setCoName(r.data.name);
    setCoExtra({ email: r.data.email, phone: r.data.phone, street: r.data.street, city: r.data.city, uf: r.data.uf, zip: r.data.zip });
    setCnpjState("done");
  }

  function addCompany() {
    const name = coName.trim();
    if (!name || busy) return;
    setCreateErr(null);
    startCreate(async () => {
      const r = await createCompany({
        name,
        cnpj: coCnpj.trim(),
        email: coExtra.email ?? "",
        phone: coExtra.phone ?? "",
        website: "",
        street: coExtra.street ?? "",
        city: coExtra.city ?? "",
        uf: coExtra.uf ?? "",
        zip: coExtra.zip ?? "",
        notes: "",
      });
      if (r.ok) {
        setCompanyOpts((p) => [{ id: r.id, name }, ...p]);
        setValue("companyId", r.id, { shouldDirty: true });
        setCoName(""); setCoCnpj(""); setCoExtra({}); setCnpjState("idle"); setOpen(null);
      } else setCreateErr(tf("createError"));
    });
  }

  function addContact() {
    const name = ctName.trim();
    const phone = ctPhone.trim();
    if (!name || !phone || busy) return;
    setCreateErr(null);
    startCreate(async () => {
      const r = await createContact({
        name,
        phone,
        email: ctEmail.trim(),
        role: "",
        companyId: getValues("companyId") || "",
        tags: "",
      });
      if (r.ok) {
        setContactOpts((p) => [{ id: r.id, name }, ...p]);
        setValue("contactId", r.id, { shouldDirty: true });
        setCtName(""); setCtPhone(""); setCtEmail(""); setOpen(null);
      } else setCreateErr(r.error === "invalid" ? tf("contactPhoneError") : tf("createError"));
    });
  }

  function addProduct() {
    const name = pName.trim();
    if (!name || busy) return;
    setCreateErr(null);
    startCreate(async () => {
      const fd = new FormData();
      fd.set("name", name);
      fd.set("kind", pKind);
      if (pPrice) fd.set("price", pPrice);
      fd.set("active", "true");
      const r = await createProductService(fd);
      if (r.ok && r.id) {
        setProductOpts((p) => [{ id: r.id!, name, kind: pKind, price: pPrice ? Number(pPrice) : null }, ...p]);
        setValue("productServiceId", r.id, { shouldDirty: true });
        setPName(""); setPPrice(""); setPKind("PRODUCT"); setOpen(null);
      } else setCreateErr(tf("createError"));
    });
  }

  async function onSubmit(values: Values) {
    setServerError(null);
    const result = await createOpportunity({
      title: values.title.trim(),
      value: Number(values.value || 0),
      stageId: values.stageId,
      companyId: values.companyId,
      contactId: values.contactId,
      productServiceId: values.productServiceId,
      ownerId: values.ownerId,
      expectedCloseDate: values.expectedCloseDate,
      notes: values.notes,
    });
    if (result.ok) {
      router.push("/app/crm");
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="title">{t("oppTitle")}</Label>
            <Input id="title" aria-invalid={Boolean(errors.title)} {...register("title", { required: tv("required") })} />
            <FieldError>{errors.title?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="value">{t("value")}</Label>
            <MoneyInput id="value" onValueChange={(n) => setValue("value", String(n))} />
            <input type="hidden" {...register("value")} />
          </div>
          <div>
            <Label htmlFor="stageId">{t("stage")}</Label>
            <select id="stageId" className={selectCls} {...register("stageId", { required: true })}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <FieldRow label={t("company")} onAdd={() => toggle("company")} open={open === "company"} addLabel={tf("newCompany")} />
            <select id="companyId" className={selectCls} {...register("companyId")}>
              <option value="">—</option>
              {companyOpts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {open === "company" ? (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                <div className="relative">
                  <input
                    value={coCnpj}
                    onChange={(e) => { setCoCnpj(e.target.value); if (cnpjState !== "idle") setCnpjState("idle"); }}
                    inputMode="numeric"
                    placeholder={tf("cnpjPlaceholder")}
                    className={cn(miniCls, "pr-9")}
                  />
                  <button type="button" onClick={() => void runCnpjLookup()} disabled={cnpjState === "loading"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label={tf("cnpjLookup")}>
                    {cnpjState === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  </button>
                </div>
                <input value={coName} onChange={(e) => setCoName(e.target.value)} placeholder={tf("companyNamePlaceholder")} className={miniCls} />
                <AddRow onAdd={addCompany} busy={busy} disabled={!coName.trim()} label={tf("add")} onCancel={() => setOpen(null)} />
                {cnpjState === "notFound" ? <p className="text-xs text-amber-600">{tf("cnpjNotFound")}</p> : null}
              </div>
            ) : null}
          </div>

          <div>
            <FieldRow label={t("contact")} onAdd={() => toggle("contact")} open={open === "contact"} addLabel={tf("newContact")} />
            <select id="contactId" className={selectCls} {...register("contactId")}>
              <option value="">—</option>
              {contactOpts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {open === "contact" ? (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                <input value={ctName} onChange={(e) => setCtName(e.target.value)} placeholder={tf("contactNamePlaceholder")} className={miniCls} />
                <input value={ctPhone} onChange={(e) => setCtPhone(e.target.value)} placeholder={tf("contactPhonePlaceholder")} className={miniCls} />
                <input value={ctEmail} onChange={(e) => setCtEmail(e.target.value)} type="email" placeholder={tf("contactEmailPlaceholder")} className={miniCls} />
                <AddRow onAdd={addContact} busy={busy} disabled={!ctName.trim() || !ctPhone.trim()} label={tf("add")} onCancel={() => setOpen(null)} />
              </div>
            ) : null}
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-medium">{tf("details")}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ownerId">{tf("owner")}</Label>
            <select id="ownerId" className={selectCls} {...register("ownerId")}>
              {!isMemberRole && <option value="">{tf("none")}</option>}
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <FieldRow label={tf("productService")} onAdd={() => toggle("product")} open={open === "product"} addLabel={tf("newProduct")} />
            <select id="productServiceId" className={selectCls} {...register("productServiceId")}>
              <option value="">{tf("none")}</option>
              {productOpts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {open === "product" ? (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder={tf("productNamePlaceholder")} className={miniCls} />
                <div className="flex gap-2">
                  <select value={pKind} onChange={(e) => setPKind(e.target.value as "PRODUCT" | "SERVICE")} className={miniCls}>
                    <option value="PRODUCT">{tf("kindProduct")}</option>
                    <option value="SERVICE">{tf("kindService")}</option>
                  </select>
                  <input value={pPrice} onChange={(e) => setPPrice(e.target.value)} inputMode="decimal" placeholder={tf("pricePlaceholder")} className={miniCls} />
                </div>
                <AddRow onAdd={addProduct} busy={busy} disabled={!pName.trim()} label={tf("add")} onCancel={() => setOpen(null)} />
              </div>
            ) : null}
          </div>
          <div>
            <Label htmlFor="expectedCloseDate">{tf("expectedCloseDate")}</Label>
            <Input id="expectedCloseDate" type="date" {...register("expectedCloseDate")} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">{tf("notes")}</Label>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </div>
        </div>
      </fieldset>

      {createErr ? <p role="alert" className="text-sm text-red-500">{createErr}</p> : null}
      {serverError ? <p role="alert" className="text-sm text-red-500">{serverError}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("creating") : t("create")}
        </Button>
        <Link
          href="/app/crm"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}

function FieldRow({ label, onAdd, open, addLabel }: { label: string; onAdd: () => void; open: boolean; addLabel: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <Label className="mb-0">{label}</Label>
      <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        {open ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
        {addLabel}
      </button>
    </div>
  );
}

function AddRow({ onAdd, onCancel, busy, disabled, label }: { onAdd: () => void; onCancel: () => void; busy: boolean; disabled: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onAdd} disabled={busy || disabled}
        className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-foreground disabled:opacity-50">
        {busy ? <Loader2 className="size-4 animate-spin" /> : label}
      </button>
      <button type="button" onClick={onCancel} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cancel">
        <X className="size-4" />
      </button>
    </div>
  );
}
