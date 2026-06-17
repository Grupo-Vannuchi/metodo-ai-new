"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input, Label } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { startExtraction } from "@/app/actions/extractions";
import { EXTRACTION_LIMITS } from "@/lib/validations/extraction";

export function NewExtraction() {
  const t = useTranslations("prospecting");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    segmento: "",
    localidade: "",
    nome: "",
    cnpj: "",
    limit: String(EXTRACTION_LIMITS[0]),
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await startExtraction({
      segmento: form.segmento,
      localidade: form.localidade,
      nome: form.nome,
      cnpj: form.cnpj,
      limit: Number(form.limit),
    });
    setPending(false);
    if (result.ok) {
      router.push(`/app/prospecting/${result.id}`);
      router.refresh();
    } else {
      setError(t(`error.${result.error}`));
    }
  }

  const selectCls = cn(
    "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none",
  );

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="segmento">{t("segmento")}</Label>
          <Input id="segmento" placeholder={t("segmentoHint")} value={form.segmento} onChange={(e) => set("segmento", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="localidade">{t("localidade")}</Label>
          <Input id="localidade" placeholder={t("localidadeHint")} value={form.localidade} onChange={(e) => set("localidade", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="nome">{t("nome")}</Label>
          <Input id="nome" value={form.nome} onChange={(e) => set("nome", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="cnpj">{t("cnpj")}</Label>
          <Input id="cnpj" value={form.cnpj} onChange={(e) => set("cnpj", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="limit">{t("limit")}</Label>
          <select id="limit" className={selectCls} value={form.limit} onChange={(e) => set("limit", e.target.value)}>
            {EXTRACTION_LIMITS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-red-500">{error}</p> : null}

      <div className="mt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner className="size-4" /> : <Search className="size-4" />}
          {pending ? t("running") : t("extract")}
        </Button>
      </div>
    </form>
  );
}
