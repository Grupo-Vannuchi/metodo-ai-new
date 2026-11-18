"use client";

import { useMemo, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Plus, X, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { SearchSelect } from "@/components/ui/search-select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { onlyDigits, formatCnpj } from "@/lib/cnpj";
import { useRegisterAssistantForm } from "@/components/app/assistant/form-store";
import type { FormBridge } from "@/lib/assistant/form-bridge";
import type { MatchRecord } from "@/lib/queries/duplicates";
import { createOpportunity } from "@/app/actions/opportunities";
import { checkCompanyMatches, createCompany, lookupCnpj } from "@/app/actions/companies";
import { checkContactMatches, createContact } from "@/app/actions/contacts";
import { createProductService } from "@/app/actions/product-services";
import { PipelineStageFields, type PipelineOption } from "@/components/crm/pipeline-stage-fields";

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
  pipelines,
  initialPipelineId,
  companies,
  contacts,
  members,
  productServices,
  initialContactId,
  initialCompanyId,
  isMemberRole,
}: {
  pipelines: PipelineOption[];
  initialPipelineId: string;
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

  // Options are stateful so a record created (or picked) in the quick add is
  // appended and selected without leaving the form.
  const [companyOpts, setCompanyOpts] = useState(companies);
  const [contactOpts, setContactOpts] = useState(contacts);
  const [productOpts, setProductOpts] = useState(productServices);
  const [open, setOpen] = useState<null | "company" | "contact" | "product">(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [busy, startCreate] = useTransition();
  // Look-alikes found before creating: the user picks one or creates anyway.
  const [matches, setMatches] = useState<{ kind: "company" | "contact"; items: MatchRecord[] } | null>(null);

  // Quick-add drafts.
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
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: {
      title: "",
      value: "",
      stageId: pipelines.find((p) => p.id === initialPipelineId)?.stages[0]?.id ?? "",
      companyId: initialCompanyId ?? "",
      contactId: initialContactId ?? "",
      productServiceId: "",
      ownerId: isMemberRole && members.length > 0 ? members[0].id : "",
      expectedCloseDate: "",
      notes: "",
    },
  });
  const stageId = useWatch({ control, name: "stageId" });
  const companyId = useWatch({ control, name: "companyId" });
  const contactId = useWatch({ control, name: "contactId" });
  const ownerId = useWatch({ control, name: "ownerId" });
  const productServiceId = useWatch({ control, name: "productServiceId" });

  // AI copilot pre-fill (review only; never saves). Money/company/contact/owner
  // stay with the user (uncontrolled money input / need real ids).
  const bridge = useMemo<FormBridge>(
    () => ({
      key: "opportunity:new",
      title: "Nova oportunidade",
      fields: [
        { name: "title", label: "Título", type: "text" },
        { name: "notes", label: "Notas / contexto", type: "textarea" },
        { name: "expectedCloseDate", label: "Previsão de fechamento", type: "date" },
        {
          name: "stageId",
          label: "Etapa do funil",
          type: "select",
          options: pipelines.flatMap((p) =>
            p.stages.map((s) => ({ value: s.id, label: `${p.name} › ${s.name}` })),
          ),
        },
      ],
      apply: (values) => {
        const set = setValue as unknown as (
          name: keyof Values,
          value: string,
          opts: { shouldDirty: boolean; shouldTouch: boolean },
        ) => void;
        const FIELDS = new Set(["title", "notes", "expectedCloseDate", "stageId"]);
        for (const [k, v] of Object.entries(values)) {
          if (FIELDS.has(k)) set(k as keyof Values, v, { shouldDirty: true, shouldTouch: true });
        }
      },
    }),
    [pipelines, setValue],
  );
  useRegisterAssistantForm(bridge);

  function toggle(which: "company" | "contact" | "product") {
    setCreateErr(null);
    setMatches(null);
    setOpen((cur) => (cur === which ? null : which));
  }

  function resetCompanyDraft() {
    setCoName(""); setCoCnpj(""); setCoExtra({}); setCnpjState("idle");
  }

  function resetContactDraft() {
    setCtName(""); setCtPhone(""); setCtEmail("");
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

  /** Uses a record that already exists instead of creating a duplicate. */
  function pickExisting(kind: "company" | "contact", item: MatchRecord) {
    const option = { id: item.id, name: item.name };
    if (kind === "company") {
      setCompanyOpts((p) => (p.some((o) => o.id === item.id) ? p : [option, ...p]));
      setValue("companyId", item.id, { shouldDirty: true });
      resetCompanyDraft();
    } else {
      setContactOpts((p) => (p.some((o) => o.id === item.id) ? p : [option, ...p]));
      setValue("contactId", item.id, { shouldDirty: true });
      resetContactDraft();
    }
    setMatches(null);
    setOpen(null);
  }

  // `force` skips the look-alike check ("Criar mesmo assim"). A failed check
  // never blocks: it is advice, the create goes on.
  function addCompany(force = false) {
    const name = coName.trim();
    if (!name || busy) return;
    setCreateErr(null);
    startCreate(async () => {
      if (!force) {
        const found = await checkCompanyMatches({ name, cnpj: coCnpj.trim() });
        if (found.ok && found.matches.length > 0) {
          setMatches({ kind: "company", items: found.matches });
          return;
        }
      }
      setMatches(null);
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
        resetCompanyDraft();
        setOpen(null);
      } else setCreateErr(tf("createError"));
    });
  }

  function addContact(force = false) {
    const name = ctName.trim();
    const phone = ctPhone.trim();
    const email = ctEmail.trim();
    if (!name || !phone || busy) return;
    setCreateErr(null);
    startCreate(async () => {
      if (!force) {
        const found = await checkContactMatches({ phone, email });
        if (found.ok && found.matches.length > 0) {
          setMatches({ kind: "contact", items: found.matches });
          return;
        }
      }
      setMatches(null);
      const r = await createContact({
        name,
        phone,
        email,
        role: "",
        companyId: getValues("companyId") || "",
        tags: "",
      });
      if (r.ok) {
        setContactOpts((p) => [{ id: r.id, name }, ...p]);
        setValue("contactId", r.id, { shouldDirty: true });
        resetContactDraft();
        setOpen(null);
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

  const reasonLabel = (reason: MatchRecord["reason"]) => tf(`match.${reason}`);

  // The quick-add inputs live inside the opportunity <form>: without this,
  // Enter would submit (create) the whole opportunity instead of adding the
  // company/contact/product — seen in the test of 18/11/2026.
  const onEnter = (action: () => void) => (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    action();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="title">{t("oppTitle")}</Label>
            <Input id="title" aria-invalid={Boolean(errors.title)} {...register("title", { required: tv("required") })} />
            <FieldError>{errors.title?.message}</FieldError>
          </div>
          <PipelineStageFields
            pipelines={pipelines}
            stageId={stageId}
            onStageChange={(next) => setValue("stageId", next, { shouldDirty: true })}
            pipelineLabel={t("pipeline")}
            stageLabel={t("stage")}
            selectClassName={selectCls}
          />
          <div>
            <Label htmlFor="value">{t("value")}</Label>
            <MoneyInput id="value" onValueChange={(n) => setValue("value", String(n))} />
            <input type="hidden" {...register("value")} />
          </div>
          <div className="hidden sm:block" />

          <div>
            <FieldRow htmlFor="companyId" label={t("company")} onAdd={() => toggle("company")} open={open === "company"} addLabel={tf("newCompany")} />
            <SearchSelect
              id="companyId"
              options={companyOpts}
              value={companyId}
              onChange={(next) => setValue("companyId", next, { shouldDirty: true })}
            />
            {open === "company" ? (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                <div className="relative">
                  <input
                    value={coCnpj}
                    onChange={(e) => { setCoCnpj(e.target.value); setMatches(null); if (cnpjState !== "idle") setCnpjState("idle"); }}
                    inputMode="numeric"
                    placeholder={tf("cnpjPlaceholder")}
                    onKeyDown={onEnter(() => void runCnpjLookup())}
                    className={cn(miniCls, "pr-9")}
                  />
                  <button type="button" onClick={() => void runCnpjLookup()} disabled={cnpjState === "loading"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label={tf("cnpjLookup")}>
                    {cnpjState === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  </button>
                </div>
                <input value={coName} onChange={(e) => { setCoName(e.target.value); setMatches(null); }} placeholder={tf("companyNamePlaceholder")} onKeyDown={onEnter(() => addCompany())} className={miniCls} />
                <AddRow onAdd={() => addCompany()} busy={busy} disabled={!coName.trim()} label={tf("add")} cancelLabel={tf("cancelAdd")} onCancel={() => toggle("company")} />
                {cnpjState === "notFound" ? <p className="text-xs text-amber-600">{tf("cnpjNotFound")}</p> : null}
                {matches?.kind === "company" ? (
                  <MatchList
                    title={tf("match.companyTitle")}
                    items={matches.items}
                    reasonLabel={reasonLabel}
                    pickLabel={tf("match.use")}
                    anywayLabel={tf("match.createAnyway")}
                    busy={busy}
                    onPick={(m) => pickExisting("company", m)}
                    onCreateAnyway={() => addCompany(true)}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <FieldRow htmlFor="contactId" label={t("contact")} onAdd={() => toggle("contact")} open={open === "contact"} addLabel={tf("newContact")} />
            <SearchSelect
              id="contactId"
              options={contactOpts}
              value={contactId}
              onChange={(next) => setValue("contactId", next, { shouldDirty: true })}
            />
            {open === "contact" ? (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                <input value={ctName} onChange={(e) => setCtName(e.target.value)} placeholder={tf("contactNamePlaceholder")} onKeyDown={onEnter(() => addContact())} className={miniCls} />
                <input value={ctPhone} onChange={(e) => { setCtPhone(e.target.value); setMatches(null); }} placeholder={tf("contactPhonePlaceholder")} onKeyDown={onEnter(() => addContact())} className={miniCls} />
                <input value={ctEmail} onChange={(e) => { setCtEmail(e.target.value); setMatches(null); }} type="email" placeholder={tf("contactEmailPlaceholder")} onKeyDown={onEnter(() => addContact())} className={miniCls} />
                <AddRow onAdd={() => addContact()} busy={busy} disabled={!ctName.trim() || !ctPhone.trim()} label={tf("add")} cancelLabel={tf("cancelAdd")} onCancel={() => toggle("contact")} />
                {matches?.kind === "contact" ? (
                  <MatchList
                    title={tf("match.contactTitle")}
                    items={matches.items}
                    reasonLabel={reasonLabel}
                    pickLabel={tf("match.use")}
                    anywayLabel={tf("match.createAnyway")}
                    busy={busy}
                    onPick={(m) => pickExisting("contact", m)}
                    onCreateAnyway={() => addContact(true)}
                  />
                ) : null}
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
            <SearchSelect
              id="ownerId"
              options={members}
              value={ownerId}
              onChange={(next) => setValue("ownerId", next, { shouldDirty: true })}
              clearable={!isMemberRole}
            />
          </div>
          <div>
            <FieldRow htmlFor="productServiceId" label={tf("productService")} onAdd={() => toggle("product")} open={open === "product"} addLabel={tf("newProduct")} />
            <SearchSelect
              id="productServiceId"
              options={productOpts}
              value={productServiceId}
              onChange={(next) => setValue("productServiceId", next, { shouldDirty: true })}
            />
            {open === "product" ? (
              <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
                <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder={tf("productNamePlaceholder")} onKeyDown={onEnter(addProduct)} className={miniCls} />
                <div className="flex gap-2">
                  <select value={pKind} onChange={(e) => setPKind(e.target.value as "PRODUCT" | "SERVICE")} className={miniCls}>
                    <option value="PRODUCT">{tf("kindProduct")}</option>
                    <option value="SERVICE">{tf("kindService")}</option>
                  </select>
                  <input value={pPrice} onChange={(e) => setPPrice(e.target.value)} inputMode="decimal" placeholder={tf("pricePlaceholder")} onKeyDown={onEnter(addProduct)} className={miniCls} />
                </div>
                <AddRow onAdd={addProduct} busy={busy} disabled={!pName.trim()} label={tf("add")} cancelLabel={tf("cancelAdd")} onCancel={() => toggle("product")} />
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

function FieldRow({ label, onAdd, open, addLabel, htmlFor }: { label: string; onAdd: () => void; open: boolean; addLabel: string; htmlFor?: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <Label htmlFor={htmlFor} className="mb-0">{label}</Label>
      <button type="button" onClick={onAdd} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        {open ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
        {addLabel}
      </button>
    </div>
  );
}

function AddRow({ onAdd, onCancel, busy, disabled, label, cancelLabel }: { onAdd: () => void; onCancel: () => void; busy: boolean; disabled: boolean; label: string; cancelLabel: string }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onAdd} disabled={busy || disabled}
        className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-foreground disabled:opacity-50">
        {busy ? <Loader2 className="size-4 animate-spin" /> : label}
      </button>
      <button type="button" onClick={onCancel} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label={cancelLabel}>
        <X className="size-4" />
      </button>
    </div>
  );
}

/** "Já existe" box: pick an existing record or create anyway. */
function MatchList({
  title,
  items,
  reasonLabel,
  pickLabel,
  anywayLabel,
  busy,
  onPick,
  onCreateAnyway,
}: {
  title: string;
  items: MatchRecord[];
  reasonLabel: (reason: MatchRecord["reason"]) => string;
  pickLabel: string;
  anywayLabel: string;
  busy: boolean;
  onPick: (item: MatchRecord) => void;
  onCreateAnyway: () => void;
}) {
  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
      <p className="font-medium text-amber-700 dark:text-amber-400">{title}</p>
      {items.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 break-words">
            <span className="font-medium">{m.name}</span>
            <span className="text-muted-foreground">
              {" · "}
              {reasonLabel(m.reason)}
              {m.detail ? ` (${m.detail})` : ""}
            </span>
          </span>
          <button type="button" onClick={() => onPick(m)}
            className="shrink-0 rounded-md bg-brand px-2.5 py-1 font-medium text-brand-foreground">
            {pickLabel}
          </button>
        </div>
      ))}
      <button type="button" onClick={onCreateAnyway} disabled={busy}
        className="self-start text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50">
        {anywayLabel}
      </button>
    </div>
  );
}
