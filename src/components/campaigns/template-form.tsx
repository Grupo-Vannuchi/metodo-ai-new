"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, FieldError } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CHANNEL_META, CHANNEL_KEYS, type ChannelKey } from "@/lib/integrations/channels/meta";
import { createTemplate } from "@/app/actions/campaigns";

type Values = { name: string; subject: string; body: string };

export function TemplateForm() {
  const t = useTranslations("campaigns");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelKey>("EMAIL");
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues: { name: "", subject: "", body: "" } });

  const meta = CHANNEL_META[channel];

  async function onSubmit(values: Values) {
    setServerError(null);
    const result = await createTemplate({
      channel,
      name: values.name.trim(),
      subject: values.subject.trim(),
      body: values.body.trim(),
    });
    if (result.ok) {
      router.push("/app/campaigns/templates");
      router.refresh();
    } else {
      setServerError(t(`error.${result.error}`));
    }
  }

  const selectCls = cn(
    "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none",
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">{t("template")}</legend>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="channel">{t("channel")}</Label>
            <select
              id="channel"
              className={selectCls}
              value={channel}
              onChange={(e) => setChannel(e.target.value as ChannelKey)}
            >
              {CHANNEL_KEYS.map((key) => (
                <option key={key} value={key}>{CHANNEL_META[key].label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="name">{t("templateName")}</Label>
            <Input id="name" aria-invalid={Boolean(errors.name)} {...register("name", { required: tv("required") })} />
            <FieldError>{errors.name?.message}</FieldError>
          </div>
          {meta.needsSubject ? (
            <div>
              <Label htmlFor="subject">{t("subject")}</Label>
              <Input id="subject" {...register("subject")} />
            </div>
          ) : null}
          <div>
            <Label htmlFor="body">{t("body")}</Label>
            <Textarea id="body" aria-invalid={Boolean(errors.body)} {...register("body", { required: tv("required") })} />
            <FieldError>{errors.body?.message}</FieldError>
            <p className="mt-1 text-xs text-muted-foreground">{t("bodyHint")}</p>
          </div>
        </div>
      </fieldset>

      {serverError ? (
        <p role="alert" className="text-sm text-red-500">{serverError}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : t("createTemplate")}
        </Button>
        <Link
          href="/app/campaigns/templates"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
