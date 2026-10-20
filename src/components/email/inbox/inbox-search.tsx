"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Search } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Spinner } from "@/components/ui/spinner";
import { SEARCH_MAX_CHARS, inboxHref, type InboxFilter } from "@/lib/email-broadcast/microsoft/inbox-core";
import { cn } from "@/lib/utils";

/** Search box (Enter searches the whole mailbox at Microsoft) and the refresh button. */
export function InboxSearch({ search, filter }: { search: string; filter: InboxFilter }) {
  const t = useTranslations("emailBroadcast.inbox");
  const router = useRouter();
  const [value, setValue] = useState(search);
  const [searching, startSearch] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  // The search runs at Microsoft (1–3 s): the transition keeps the spinner up until the page lands.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startSearch(() => router.push(inboxHref({ filtro: filter, q: value.trim().slice(0, SEARCH_MAX_CHARS) })));
  }

  return (
    <div className="flex items-center gap-2">
      <form
        role="search"
        onSubmit={onSubmit}
        className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground focus-within:border-brand"
      >
        {searching ? (
          <span aria-hidden="true" className="inline-flex size-4 shrink-0 text-brand">
            <Spinner className="size-full" />
          </span>
        ) : (
          <Search aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span role="status" className="sr-only">
          {searching ? t("loading") : null}
        </span>
        <label htmlFor="inbox-search" className="sr-only">
          {t("searchLabel")}
        </label>
        <input
          id="inbox-search"
          type="search"
          value={value}
          maxLength={SEARCH_MAX_CHARS}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </form>
      <button
        type="button"
        onClick={() => startRefresh(() => router.refresh())}
        disabled={refreshing}
        aria-label={t("refresh")}
        title={t("refresh")}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-brand transition-colors hover:bg-muted disabled:opacity-60"
      >
        <RefreshCw aria-hidden="true" className={cn("size-4", refreshing && "animate-spin")} />
      </button>
    </div>
  );
}
