"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { renameCloudCampaign } from "@/app/actions/whatsapp-cloud-campaigns";

/** Campanha oficial: só o nome é editável. */
export function CloudCampaignRenameForm({
  id,
  name,
  templateName,
}: {
  id: string;
  name: string;
  templateName: string | null;
}) {
  const t = useTranslations("campaigns");
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await renameCloudCampaign(id, value);
        setBusy(false);
        if (r.ok) {
          router.push(`/app/campaigns/${id}`);
          router.refresh();
        } else {
          setError(t("error.unknown"));
        }
      }}
    >
      <div>
        <Label htmlFor="name">{t("campaignName")}</Label>
        <Input id="name" value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} />
      </div>
      {templateName ? <p className="text-sm text-muted-foreground">{t("cloud.templateUsed", { name: templateName })}</p> : null}
      <p className="text-xs text-muted-foreground">{t("cloud.renameOnly")}</p>
      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={busy || !value.trim()}>
          {t("cloud.rename")}
        </Button>
      </div>
    </form>
  );
}
