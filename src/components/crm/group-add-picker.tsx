"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Search, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { normalizeSearch } from "@/lib/search-options";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { listGroupsForAddAction, type GroupAddActionError } from "@/app/actions/whatsapp-group-add";
import type { GroupOption } from "@/lib/whatsapp/group-add/service";
import { Loading, NEEDS_INBOX, Notice } from "@/components/crm/group-add-parts";

/** Screen 1 of the dialog: the groups of the member's own number. */

export type GroupsState =
  | { kind: "loading" }
  | { kind: "ready"; groups: GroupOption[] }
  | { kind: "error"; error: GroupAddActionError };

/** The call can throw (the network); a throw reads as the generic error. */
export async function fetchGroups(): Promise<GroupsState> {
  try {
    const r = await listGroupsForAddAction();
    return r.ok ? { kind: "ready", groups: r.groups } : { kind: "error", error: r.error };
  } catch {
    return { kind: "error", error: "unknown" };
  }
}

/**
 * Every group of the number, by name, with a search box. Where the number is admin the group can be picked; the others are
 * shown, with the reason, and blocked (`admin` false, or null when the server could not tell, which is blocked too).
 */
export function GroupPicker({
  state,
  query,
  onQuery,
  onPick,
  onRetry,
}: {
  state: GroupsState;
  query: string;
  onQuery: (value: string) => void;
  onPick: (group: GroupOption) => void;
  onRetry: () => void;
}) {
  const t = useTranslations("crm.groupAdd.dialog");
  const te = useTranslations("crm.groupAdd.error");

  if (state.kind === "loading") return <Loading text={t("loadingGroups")} />;

  if (state.kind === "error") {
    return (
      <Notice icon={<AlertTriangle className="size-4" />}>
        <p>{te(state.error)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {NEEDS_INBOX.includes(state.error) ? (
            <Link href="/app/inbox" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("openInbox")}
            </Link>
          ) : null}
          {state.error !== "no_connection" ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t("retry")}
            </Button>
          ) : null}
        </div>
      </Notice>
    );
  }

  const wanted = normalizeSearch(query);
  // The groups where the number is admin come first (the others are shown, but blocked); the server's order (by name) stays within each.
  const shown = state.groups
    .filter((g) => !wanted || normalizeSearch(g.subject).includes(wanted))
    .sort((a, b) => Number(b.admin === true) - Number(a.admin === true));

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="pl-9"
        />
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{state.groups.length === 0 ? t("noGroups") : t("noMatch")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((g) => {
            const pickable = g.admin === true;
            return (
              <li key={g.jid}>
                <button
                  type="button"
                  disabled={!pickable}
                  onClick={() => onPick(g)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    pickable ? "border-border hover:border-brand/50 hover:bg-muted/40" : "cursor-not-allowed border-border/60 opacity-60",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                    <Users className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{g.subject || t("unnamedGroup")}</span>
                    <span className="block text-xs text-muted-foreground">{t("participants", { count: g.size })}</span>
                  </span>
                  <span
                    className={cn(
                      "max-w-[11rem] shrink-0 text-right text-xs",
                      pickable ? "font-medium text-green-600 dark:text-green-400" : "text-muted-foreground",
                    )}
                  >
                    {g.admin === true ? t("adminYes") : g.admin === false ? t("adminNo") : t("adminUnknown")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
