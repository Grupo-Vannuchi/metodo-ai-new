"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import type { UseFormRegister, UseFormSetValue, UseFormGetValues } from "react-hook-form";
import { Label, Textarea, FieldError } from "@/components/ui/field";

/** The subset of the template form the body field needs to read/write. */
type BodyForm = { name: string; subject: string; body: string };

/** Campaign merge variables supported by the dispatcher (see lib/dispatch.ts). */
const VARIABLES = ["{{nome}}", "{{empresa}}"] as const;

/**
 * Message body editor shared by the create/edit template forms. Adds clickable
 * chips that insert merge variables and a spintax snippet at the cursor, so the
 * user doesn't type the tokens by hand.
 */
export function TemplateBodyField({
  register,
  setValue,
  getValues,
  error,
}: {
  register: UseFormRegister<BodyForm>;
  setValue: UseFormSetValue<BodyForm>;
  getValues: UseFormGetValues<BodyForm>;
  error?: string;
}) {
  const t = useTranslations("campaigns");
  const tv = useTranslations("validation");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const bodyReg = register("body", { required: tv("required") });

  function insert(token: string) {
    const el = ref.current;
    const current = getValues("body") ?? "";
    if (!el) {
      setValue("body", current + token, { shouldDirty: true, shouldValidate: true });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setValue("body", next, { shouldDirty: true, shouldValidate: true });
    // RHF writes the value to the uncontrolled element synchronously; restore the
    // caret just after the inserted token.
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  }

  const chipCls =
    "inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/50 hover:text-brand";

  return (
    <div>
      <Label htmlFor="body">{t("body")}</Label>
      <Textarea
        id="body"
        rows={5}
        aria-invalid={Boolean(error)}
        {...bodyReg}
        ref={(el) => {
          bodyReg.ref(el);
          ref.current = el;
        }}
      />
      <FieldError>{error}</FieldError>

      {/* Insert helpers */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs text-muted-foreground">{t("insertVar")}</span>
        {VARIABLES.map((v) => (
          <button key={v} type="button" onClick={() => insert(v)} className={chipCls}>
            <code className="font-mono">{v}</code>
          </button>
        ))}
        <button type="button" onClick={() => insert("{oi|olá|e aí}")} className={chipCls}>
          <Sparkles className="size-3.5" />
          {t("insertSpintax")}
        </button>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">{t("bodyHint")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("spintaxHint")} <code className="rounded bg-muted px-1">{"{oi|olá|e aí}"}</code>
      </p>
    </div>
  );
}
