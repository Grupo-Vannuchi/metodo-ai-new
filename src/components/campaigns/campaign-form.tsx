"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CHANNEL_META, CHANNEL_KEYS, type ChannelKey } from "@/lib/integrations/channels/meta";
import { createCampaign } from "@/app/actions/campaigns";

type TemplateOption = { id: string; name: string; channel: string };
type Values = { name: string; templateId: string; tag: string };

export function CampaignForm({ templates }: { templates: TemplateOption[] }) {
  const t = useTranslations("campaigns");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelKey>("EMAIL");
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues: { name: "", templateId: "", tag: "" } });

  const channelTemplates = templates.filter((tpl) => tpl.channel === channel);

  async function onSubmit(values: Values) {
    setServerError(null);
    const result = await createCampaign({
      name: values.name.trim(),
      channel,
      templateId: values.templateId,
      tag: values.tag.trim(),
    });
    if (result.ok) {
      router.push(`/app/campaigns/${result.id}`);
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
        <legend className="px-1 text-sm font-semibold">{t("campaign")}</legend>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="name">{t("campaignName")}</Label>
            <Input id="name" aria-invalid={Boolean(errors.name)} {...register("name", { required: tv("required") })} />
            <FieldError>{errors.name?.message}</FieldError>
          </div>
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
            <Label htmlFor="templateId">{t("templateLabel")}</Label>
            <select
              id="templateId"
              className={selectCls}
              aria-invalid={Boolean(errors.templateId)}
              {...register("templateId", { required: tv("required") })}
            >
              <option value="">{t("selectTemplate")}</option>
              {channelTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
            </select>
            <FieldError>{errors.templateId?.message}</FieldError>
            {channelTemplates.length === 0 ? (
              <p className="mt-1 text-xs text-amber-600">{t("noTemplateForChannel")}</p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="tag">{t("tagFilter")}</Label>
            <Input id="tag" placeholder="ex.: lead" {...register("tag")} />
            <p className="mt-1 text-xs text-muted-foreground">{t("tagHint")}</p>
          </div>
        </div>
      </fieldset>

      {serverError ? (
        <p role="alert" className="text-sm text-red-500">{serverError}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("saving") : t("createCampaign")}
        </Button>
        <Link
          href="/app/campaigns"
          className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
