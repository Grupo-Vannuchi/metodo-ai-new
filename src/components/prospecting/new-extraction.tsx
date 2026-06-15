"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  AVAILABLE_EXTRACTORS,
  EXTRACTOR_META,
  type ExtractorProviderKey,
} from "@/lib/integrations/extractors/meta";
import { startExtraction } from "@/app/actions/extractions";

export function NewExtraction() {
  const t = useTranslations("prospecting");
  const router = useRouter();
  const [provider, setProvider] = useState<ExtractorProviderKey>(
    AVAILABLE_EXTRACTORS[0],
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const meta = EXTRACTOR_META[provider];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const result = await startExtraction({ provider, query });
      if (result.ok) {
        router.push(`/app/prospecting/${result.id}`);
        router.refresh();
      } else {
        setError(t(`error.${result.error}`));
      }
    });
  }

  const selectCls = cn(
    "w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm",
    "focus-visible:border-brand focus-visible:outline-none",
  );

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <div>
          <Label htmlFor="provider">{t("provider")}</Label>
          <select
            id="provider"
            className={selectCls}
            value={provider}
            onChange={(e) => setProvider(e.target.value as ExtractorProviderKey)}
          >
            {AVAILABLE_EXTRACTORS.map((key) => (
              <option key={key} value={key}>{EXTRACTOR_META[key].label}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="query">{meta.queryLabel}</Label>
          <Input
            id="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={meta.queryPlaceholder}
            required
          />
        </div>
        <Button type="submit" size="lg" disabled={pending || !query.trim()}>
          <Search className="size-4" />
          {pending ? t("running") : t("extract")}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{meta.description}</p>
      {error ? <p role="alert" className="mt-2 text-sm text-red-500">{error}</p> : null}
    </form>
  );
}
