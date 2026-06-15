"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import {
  renamePipeline,
  setDefaultPipeline,
  deletePipeline,
} from "@/app/actions/pipelines";

export function PipelineSettings({
  id,
  name,
  isDefault,
}: {
  id: string;
  name: string;
  isDefault: boolean;
}) {
  const t = useTranslations("crm.pipelines");
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok && r.error) setError(t(`error.${r.error}`));
      if (r.ok) after?.();
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="sm:max-w-xs"
        />
        <Button
          type="button"
          variant="outline"
          disabled={pending || !value.trim()}
          onClick={() => run(() => renamePipeline(id, { name: value }))}
        >
          {t("save")}
        </Button>
        <div className="flex gap-2 sm:ml-auto">
          {!isDefault ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => setDefaultPipeline(id))}
            >
              <Star className="size-4" />
              {t("makeDefault")}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-3 py-2 text-sm font-medium text-brand">
              <Star className="size-4" />
              {t("isDefault")}
            </span>
          )}
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t("confirmDeletePipeline"))) return;
              run(() => deletePipeline(id), () => router.push("/app/crm/pipelines"));
            }}
          >
            <Trash2 className="size-4" />
            {t("deletePipeline")}
          </Button>
        </div>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
