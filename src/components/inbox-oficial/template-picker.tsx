"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import {
  renderTemplateText,
  suggestValues,
  type CloudTemplateOption,
  type ParamContext,
} from "@/lib/whatsapp-cloud/template-params";
import { cloudContactParams, sendCloudTemplate } from "@/app/actions/inbox-oficial";
import { Modal } from "./modal";

const EMPTY: ParamContext = { nome: "", empresa: "" };

/** Escolher um modelo aprovado, preencher as variáveis, ver a prévia e enviar. */
export function TemplatePicker({
  open,
  onClose,
  templates,
  conversationId,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  templates: CloudTemplateOption[];
  conversationId: string;
  onSent: () => void;
}) {
  const t = useTranslations("inboxOficial.picker");
  const tr = useTranslations("inboxOficial");
  const toast = useToast();
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [params, setParams] = useState<ParamContext | null>(null);
  const [sending, setSending] = useState(false);
  const selected = templates.find((x) => x.id === templateId) ?? null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    void cloudContactParams(conversationId).then((p) => {
      if (active) setParams(p ?? EMPTY);
    });
    return () => {
      active = false;
    };
  }, [open, conversationId]);

  function choose(id: string) {
    setTemplateId(id);
    const opt = templates.find((x) => x.id === id);
    setValues(opt ? suggestValues(opt.variables, params ?? EMPTY) : {});
  }

  const preview = useMemo(() => {
    if (!selected) return "";
    const shown = Object.fromEntries(selected.variables.map((v) => [v.id, values[v.id]?.trim() || `{{${v.key}}}`]));
    return renderTemplateText(selected.def, shown);
  }, [selected, values]);

  async function send() {
    if (!selected) return;
    setSending(true);
    try {
      const r = await sendCloudTemplate(conversationId, selected.id, values);
      if (r.ok) {
        setTemplateId("");
        setValues({});
        onSent();
      } else {
        toast(tr(`errors.${r.error}`, { detail: r.detail ?? "" }), { variant: "error" });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")} closeLabel={tr("close")}>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="tpl">{t("choose")}</Label>
            <select
              id="tpl"
              value={templateId}
              onChange={(e) => choose(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm focus-visible:border-brand focus-visible:outline-none"
            >
              <option value="">{t("choose")}</option>
              {templates.map((o) => (
                <option key={o.id} value={o.id} disabled={o.unsupported !== null}>
                  {o.name} ({o.language}){o.unsupported ? ` — ${t(`unsupported.${o.unsupported}`)}` : ""}
                </option>
              ))}
            </select>
          </div>
          {selected && selected.variables.length > 0 ? (
            <div className="grid gap-3">
              {selected.variables.map((v) => (
                <div key={v.id}>
                  <Label htmlFor={`var-${v.id}`}>{t("variable", { name: v.key, part: t(`part.${v.component}`) })}</Label>
                  <Input
                    id={`var-${v.id}`}
                    value={values[v.id] ?? ""}
                    maxLength={1000}
                    onChange={(e) => setValues((s) => ({ ...s, [v.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ) : null}
          {selected ? (
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("preview")}</p>
              <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{preview}</p>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" onClick={send} disabled={!selected || sending}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("send")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
