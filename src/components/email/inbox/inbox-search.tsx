"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, Search } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Spinner } from "@/components/ui/spinner";
import {
  SEARCH_MAX_CHARS,
  SEARCH_MIN_CHARS,
  inboxHref,
  type InboxFilter,
  type MailboxChannel,
} from "@/lib/email-broadcast/microsoft/inbox-core";
import { cn } from "@/lib/utils";

/** Pause after the last keystroke before searching at Microsoft. */
const TYPE_DEBOUNCE_MS = 400;

/**
 * Search box and refresh button. The search runs while typing, from
 * SEARCH_MIN_CHARS letters on (Enter searches at once); clearing the box brings
 * the whole list back. An open e-mail stays open.
 */
export function InboxSearch({
  channel,
  search,
  filter,
  messageId,
}: {
  channel: MailboxChannel;
  search: string;
  filter: InboxFilter;
  messageId: string | null;
}) {
  const t = useTranslations("emailBroadcast.inbox");
  const router = useRouter();
  const [value, setValue] = useState(search);
  // The URL's search changed from outside (tab, "Tentar de novo"): show it, unless we asked for it.
  const [seen, setSeen] = useState(search);
  const [asked, setAsked] = useState(search);
  if (search !== seen) {
    setSeen(search);
    if (search !== asked) setValue(search);
  }
  const [searching, startSearch] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  // The search runs at the mailbox's server (1–3 s): the transition keeps the spinner up until the page lands.
  // replace, not push: each keystroke must not become a history entry.
  function go(q: string) {
    setAsked(q);
    startSearch(() => router.replace(inboxHref({ canal: channel, filtro: filter, q, msg: messageId ?? undefined })));
  }

  useEffect(() => {
    const q = value.trim().slice(0, SEARCH_MAX_CHARS);
    if (q === search || (q.length > 0 && q.length < SEARCH_MIN_CHARS)) return;
    const timer = setTimeout(() => go(q), TYPE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // go reads only props and setters; listing it would restart the pause on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, search]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = value.trim().slice(0, SEARCH_MAX_CHARS);
    if (q !== search) go(q);
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
