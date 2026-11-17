"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  defaultMapping,
  renderTemplateText,
  resolveParamValues,
  type CloudTemplateOption,
  type ParamContext,
  type ParamMapping,
  type ParamSource,
} from "@/lib/whatsapp-cloud/template-params";

export type CloudCampaignValue = { templateId: string; params: ParamMapping };

const SAMPLE: ParamContext = { nome: "Maria", empresa: "Empresa Exemplo" };
const selectCls = cn(
  "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
  "focus-visible:border-brand focus-visible:outline-none",
);

/** Modelo da Meta + origem de cada variável + prévia + aviso de limite. */
export function CloudCampaignFields({
  templates,
  value,
  onChange,
  sample,
  messagingLimit,
  audienceCount,
}: {
  templates: CloudTemplateOption[];
  value: CloudCampaignValue;
  onChange: (v: CloudCampaignValue) => void;
  sample: ParamContext | null;
  messagingLimit: string | null;
  audienceCount: number | null;
}) {
  const t = useTranslations("campaigns.cloud");
  const selected = templates.find((x) => x.id === value.templateId) ?? null;
  const preview = useMemo(
    () =>
      selected
        ? renderTemplateText(selected.def, resolveParamValues(selected.variables, value.params, sample ?? SAMPLE))
        : "",
    [selected, value.params, sample],
  );

  function pick(id: string) {
    const tpl = templates.find((x) => x.id === id);
    onChange({ templateId: id, params: tpl ? defaultMapping(tpl.variables) : {} });
  }

  function setParam(id: string, next: ParamSource) {
    onChange({ ...value, params: { ...value.params, [id]: next } });
  }

  return (
    <div className="grid gap-4">
      <div>
        <Label htmlFor="cloudTemplate">{t("template")}</Label>
        <select id="cloudTemplate" className={selectCls} value={value.templateId} onChange={(e) => pick(e.target.value)}>
          <option value="">{t("selectTemplate")}</option>
          {templates.map((o) => (
            <option key={o.id} value={o.id} disabled={o.unsupported !== null}>
              {o.name} ({o.language} · {o.category}){o.unsupported ? ` — ${t(`unsupported.${o.unsupported}`)}` : ""}
            </option>
          ))}
        </select>
        {templates.length === 0 ? <p className="mt-1 text-xs text-amber-600">{t("noTemplates")}</p> : null}
      </div>

      {selected && selected.variables.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">{t("variables")}</p>
          {selected.variables.map((v) => {
            const m: ParamSource = value.params[v.id] ?? { source: "fixo", value: "" };
            const placeholder = m.source === "fixo" ? t("fixedValue") : t("fallback");
            return (
              <div key={v.id} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
                <span className="font-mono text-xs text-muted-foreground">
                  {`{{${v.key}}}`} · {t(`part.${v.component}`)}
                </span>
                <select
                  aria-label={t("sourceLabel", { name: v.key })}
                  className={selectCls}
                  value={m.source}
                  onChange={(e) => setParam(v.id, { source: e.target.value as ParamSource["source"], value: m.value })}
                >
                  <option value="nome">{t("source.nome")}</option>
                  <option value="empresa">{t("source.empresa")}</option>
                  <option value="fixo">{t("source.fixo")}</option>
                </select>
                <Input
                  aria-label={placeholder}
                  placeholder={placeholder}
                  value={m.value ?? ""}
                  maxLength={1000}
                  onChange={(e) => setParam(v.id, { ...m, value: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <div>
          <p className="mb-1.5 text-sm font-medium">
            {t("preview")}
            {sample ? ` — ${t("previewWith", { name: sample.nome || "—" })}` : ""}
          </p>
          <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{preview}</p>
        </div>
      ) : null}

      {messagingLimit ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t("limitWarning", { limit: messagingLimit, count: audienceCount ?? 0 })}
        </p>
      ) : null}
    </div>
  );
}
