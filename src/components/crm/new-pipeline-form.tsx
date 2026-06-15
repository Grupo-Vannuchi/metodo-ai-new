"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { createPipeline } from "@/app/actions/pipelines";

export function NewPipelineForm() {
  const t = useTranslations("crm.pipelines");
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createPipeline({ name });
      if (r.ok) {
        setName("");
        router.refresh();
      } else {
        setError(t(`error.${r.error}`));
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="pname">{t("name")}</Label>
          <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          <Plus className="size-4" />
          {pending ? t("creating") : t("create")}
        </Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-500">{error}</p> : null}
    </form>
  );
}
