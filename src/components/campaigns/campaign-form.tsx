"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { CHANNEL_META, CHANNEL_KEYS, type ChannelKey } from "@/lib/integrations/channels/meta";
import { createCampaign, countAudience } from "@/app/actions/campaigns";
import type { AudienceFilter } from "@/lib/queries/campaigns";

type Option = { id: string; name: string };
type TemplateOption = { id: string; name: string; channel: string };
type Values = { name: string; templateId: string };

const OPP_STATUSES = ["OPEN", "WON", "LOST", "CANCELED"] as const;

export function CampaignForm({
  templates,
  folders,
  facets,
  stages,
  members,
}: {
  templates: TemplateOption[];
  folders: Option[];
  facets: { tags: string[]; sources: string[] };
  stages: Option[];
  members: Option[];
}) {
  const t = useTranslations("campaigns");
  const tv = useTranslations("validation");
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelKey>("EMAIL");
  const [serverError, setServerError] = useState<string | null>(null);

  // Audience segmentation (local state, combined with AND).
  const [tags, setTags] = useState<string[]>([]);
  const [folderId, setFolderId] = useState("");
  const [source, setSource] = useState("");
  const [stageId, setStageId] = useState("");
  const [oppStatus, setOppStatus] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [count, setCount] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues: { name: "", templateId: "" } });

  const channelTemplates = templates.filter((tpl) => tpl.channel === channel);

  const filter: AudienceFilter = {
    tags: tags.length ? tags : undefined,
    folderId: folderId || undefined,
    source: source || undefined,
    stageId: stageId || undefined,
    oppStatus: (oppStatus || undefined) as AudienceFilter["oppStatus"],
    ownerId: ownerId || undefined,
  };

  // Live recipient estimate. All state changes happen inside the async timeout,
  // never synchronously in the effect body.
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      const n = await countAudience(channel, {
        tags: tags.length ? tags : undefined,
        folderId: folderId || undefined,
        source: source || undefined,
        stageId: stageId || undefined,
        oppStatus: (oppStatus || undefined) as AudienceFilter["oppStatus"],
        ownerId: ownerId || undefined,
      });
      if (active) setCount(n);
    }, 350);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [channel, tags, folderId, source, stageId, oppStatus, ownerId]);

  function toggleTag(tag: string) {
    setTags((s) => (s.includes(tag) ? s.filter((x) => x !== tag) : [...s, tag]));
  }

  async function onSubmit(values: Values) {
    setServerError(null);
    const result = await createCampaign({ name: values.name.trim(), channel, templateId: values.templateId, ...filter });
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
            <select id="channel" className={selectCls} value={channel} onChange={(e) => setChannel(e.target.value as ChannelKey)}>
              {CHANNEL_KEYS.map((key) => (
                <option key={key} value={key}>{CHANNEL_META[key].label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="templateId">{t("templateLabel")}</Label>
            <select id="templateId" className={selectCls} aria-invalid={Boolean(errors.templateId)} {...register("templateId", { required: tv("required") })}>
              <option value="">{t("selectTemplate")}</option>
              {channelTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
            </select>
            <FieldError>{errors.templateId?.message}</FieldError>
            {channelTemplates.length === 0 ? <p className="mt-1 text-xs text-amber-600">{t("noTemplateForChannel")}</p> : null}
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">{t("audience")}</legend>
        <p className="px-1 text-xs text-muted-foreground">{t("audienceHint")}</p>
        <div className="mt-4 grid gap-4">
          {facets.tags.length > 0 ? (
            <div>
              <Label>{t("audienceTags")}</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {facets.tags.map((tag) => {
                  const on = tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm transition-colors",
                        on ? "border-brand bg-brand/10 font-medium text-brand" : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {folders.length > 0 ? (
              <div>
                <Label htmlFor="folderId">{t("audienceFolder")}</Label>
                <select id="folderId" className={selectCls} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">{t("audienceAny")}</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            {facets.sources.length > 0 ? (
              <div>
                <Label htmlFor="source">{t("audienceSource")}</Label>
                <select id="source" className={selectCls} value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">{t("audienceAny")}</option>
                  {facets.sources.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            ) : null}
            {stages.length > 0 ? (
              <div>
                <Label htmlFor="stageId">{t("audienceStage")}</Label>
                <select id="stageId" className={selectCls} value={stageId} onChange={(e) => setStageId(e.target.value)}>
                  <option value="">{t("audienceAny")}</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <Label htmlFor="oppStatus">{t("audienceStatus")}</Label>
              <select id="oppStatus" className={selectCls} value={oppStatus} onChange={(e) => setOppStatus(e.target.value)}>
                <option value="">{t("audienceAny")}</option>
                {OPP_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`status.${s}`)}</option>
                ))}
              </select>
            </div>
            {members.length > 0 ? (
              <div>
                <Label htmlFor="ownerId">{t("audienceOwner")}</Label>
                <select id="ownerId" className={selectCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">{t("audienceAny")}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <p className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <Users className="size-4 shrink-0" />
            {count === null ? t("countingAudience") : t("recipientsCount", { count })}
          </p>
        </div>
      </fieldset>

      {serverError ? <p role="alert" className="text-sm text-red-500">{serverError}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={isSubmitting || count === 0}>
          {isSubmitting ? t("saving") : t("createCampaign")}
        </Button>
        <Link href="/app/campaigns" className="inline-flex h-13 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground">
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
