"use client";

import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangle, Clock, ShieldAlert, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import {
  previewGroupAddAction,
  type GroupAddActionError,
  type GroupAddPreview,
} from "@/app/actions/whatsapp-group-add";
import {
  GROUP_ADD_DAILY_CAP,
  GROUP_ADD_MAX_CONTACTS,
  GROUP_ADD_PAUSE_SECONDS,
  GROUP_ADD_WINDOW,
  INVITE_TEXT_MAX,
  WHATSAPP_GROUP_MAX,
} from "@/lib/whatsapp/group-add/core";
import type { GroupAddSource, GroupOption } from "@/lib/whatsapp/group-add/service";
import { forecastValues } from "@/components/crm/group-add-format";
import { Loading, NEEDS_INBOX, Notice } from "@/components/crm/group-add-parts";

/** Screen 2 of the dialog: the review before a round starts. */

export type PreviewState =
  | { kind: "loading" }
  // `nowMs` is when the answer came: the day words of the forecast ("today", "tomorrow") are told from it.
  | { kind: "ready"; preview: GroupAddPreview; nowMs: number }
  | { kind: "error"; error: GroupAddActionError };

/** The call can throw (the network); a throw reads as the generic error. */
export async function fetchPreview(source: GroupAddSource, groupJid: string): Promise<PreviewState> {
  try {
    const r = await previewGroupAddAction({ source, groupJid });
    return r.ok ? { kind: "ready", preview: r, nowMs: Date.now() } : { kind: "error", error: r.error };
  } catch {
    return { kind: "error", error: "unknown" };
  }
}

/**
 * What the server says of the group and the contacts (the counts, the notices, what the number spent today, when it would
 * end), the invite text to edit, and the pace. Shows; it decides nothing. `count` is how many contacts the member sees in the
 * source, to say so when a folder holds more than a round takes.
 */
export function Review({
  source,
  count,
  group,
  state,
  invite,
  inviteId,
  onInvite,
}: {
  source: GroupAddSource;
  count: number;
  group: GroupOption;
  state: PreviewState;
  invite: string;
  inviteId: string;
  onInvite: (value: string) => void;
}) {
  const t = useTranslations("crm.groupAdd");
  const format = useFormatter();

  const heading = (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Users className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{group.subject || t("dialog.unnamedGroup")}</p>
        <p className="text-xs text-muted-foreground">{t("dialog.participants", { count: group.size })}</p>
      </div>
    </div>
  );

  if (state.kind === "loading") {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        <Loading text={t("dialog.checking")} />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        <Notice icon={<AlertTriangle className="size-4" />}>
          <p>{t(`error.${state.error}`)}</p>
          {NEEDS_INBOX.includes(state.error) ? (
            <Link href="/app/inbox" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}>
              {t("dialog.openInbox")}
            </Link>
          ) : null}
        </Notice>
      </div>
    );
  }

  const { preview, nowMs } = state;
  const { counts } = preview;
  // The rows that are zero stay out, except the two that are the point: how many were chosen and how many will be added.
  const rows: { key: string; value: number; strong?: boolean }[] = [
    { key: "total", value: counts.total },
    { key: "pending", value: counts.pending, strong: true },
    { key: "alreadyIn", value: counts.alreadyIn },
    { key: "noWhatsapp", value: counts.noWhatsapp },
    { key: "skipped", value: counts.skipped },
    { key: "leftGroup", value: counts.leftGroup },
    { key: "alreadyInvited", value: counts.alreadyInvited },
  ].filter((r) => r.value > 0 || r.key === "total" || r.key === "pending");
  // A folder of more than a round takes is cut by the server (the oldest contacts go in); a selection that big never gets here.
  const folderCut = source.kind === "folder" && count > GROUP_ADD_MAX_CONTACTS;

  return (
    <div className="flex flex-col gap-4">
      {heading}

      <dl className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4 px-4 py-2">
            <dt className={r.strong ? "font-medium" : "text-muted-foreground"}>{t(`dialog.counts.${r.key}`)}</dt>
            <dd className={cn("shrink-0 tabular-nums", r.strong ? "text-base font-bold text-brand" : "font-semibold")}>
              {format.number(r.value)}
            </dd>
          </div>
        ))}
      </dl>

      <ul className="flex flex-col gap-2">
        <li>
          <Notice icon={<ShieldAlert className="size-4" />}>{t("dialog.privacy")}</Notice>
        </li>
        {preview.group.announce === false ? (
          <li>
            <Notice icon={<AlertTriangle className="size-4" />}>{t("dialog.everyoneCanSend")}</Notice>
          </li>
        ) : null}
        {preview.overLimit ? (
          <li>
            <Notice icon={<AlertTriangle className="size-4" />}>
              {t("dialog.overLimit", { max: format.number(WHATSAPP_GROUP_MAX) })} {t("dialog.overLimitHint")}
            </Notice>
          </li>
        ) : null}
        {folderCut ? (
          <li>
            <Notice icon={<AlertTriangle className="size-4" />}>
              {t("dialog.folderCut", { count: format.number(count), max: format.number(GROUP_ADD_MAX_CONTACTS) })}
            </Notice>
          </li>
        ) : null}
      </ul>

      <div>
        <Label htmlFor={inviteId}>{t("dialog.inviteLabel")}</Label>
        <Textarea
          id={inviteId}
          value={invite}
          onChange={(e) => onInvite(e.target.value)}
          maxLength={INVITE_TEXT_MAX}
          rows={4}
          className="min-h-24"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {t("dialog.inviteHelp")} {t("dialog.inviteVars")} {t("dialog.inviteLinkHint")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <p className="flex items-start gap-2 text-muted-foreground">
          <Clock className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("dialog.pace", {
              min: GROUP_ADD_PAUSE_SECONDS.min,
              max: GROUP_ADD_PAUSE_SECONDS.max,
              start: GROUP_ADD_WINDOW.startHour,
              end: GROUP_ADD_WINDOW.endHour,
              cap: GROUP_ADD_DAILY_CAP,
            })}
          </span>
        </p>
        {preview.usedToday > 0 ? (
          <p className="pl-6 text-muted-foreground">
            {t("dialog.usedToday", { used: format.number(preview.usedToday), cap: GROUP_ADD_DAILY_CAP })}
          </p>
        ) : null}
        {counts.pending > 0 ? (
          <p className="pl-6 font-medium">{t("forecast", forecastValues(format, new Date(preview.forecastAt), new Date(nowMs)))}</p>
        ) : (
          <p className="pl-6 font-medium text-amber-600 dark:text-amber-400">{t("dialog.nothingToAdd")}</p>
        )}
      </div>
    </div>
  );
}
