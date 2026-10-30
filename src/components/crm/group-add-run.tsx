"use client";

import { useEffect, useRef, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowLeft, Ban, Pause, Play } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { AutoRefresh } from "@/components/email/auto-refresh";
import {
  cancelGroupAddAction,
  pauseGroupAddAction,
  pokeGroupAddAction,
  resumeGroupAddAction,
} from "@/app/actions/whatsapp-group-add";
import {
  GROUP_ADD_DAILY_CAP,
  GROUP_ADD_WINDOW,
  WHATSAPP_GROUP_MAX,
  type GroupAddItemStatus,
} from "@/lib/whatsapp/group-add/core";
import { GROUP_ADD_TIME_ZONE, forecastValues, reasonNote } from "@/components/crm/group-add-format";

type RunStatus = "QUEUED" | "RUNNING" | "PAUSED" | "DONE" | "CANCELED";

export type GroupAddRunProps = {
  runId: string;
  groupName: string;
  status: RunStatus;
  /** "manual" | "disconnected" | "not_admin" | "no_connection" | "number_changed" | "error" while PAUSED. */
  pausedReason: string | null;
  /** A run paused as not_admin only because the group could not be read: it goes on by itself, so it is not "no longer admin". */
  unreadable: boolean;
  /** Why the next person is not tried right now ("pace" | "window" | "cap" | "unavailable"); null when nothing is being waited for. */
  waitReason: string | null;
  counts: Record<GroupAddItemStatus, number>;
  items: { contactId: string; contactName: string; status: GroupAddItemStatus; reason: string | null; processedAt: string | null }[];
  startedAt: string | null;
  finishedAt: string | null;
  /** When the people still waiting would be done; null when the run is not one that is going on. */
  forecastAt: string | null;
  /** When the server read the run: the day words of the forecast are told from it, so the markup is the same on both sides. */
  now: string;
  /** Whether the viewer may pause, resume and cancel: who started the round, or an admin. Decided by the server. */
  canSteer: boolean;
};

type Tone = "neutral" | "info" | "good" | "warn" | "bad";

const TONE_CHIP: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  good: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  bad: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const TONE_BAR: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  info: "bg-blue-500",
  good: "bg-green-600",
  warn: "bg-amber-500",
  bad: "bg-red-500",
};

const RUN_TONE: Record<RunStatus, Tone> = {
  QUEUED: "neutral",
  RUNNING: "info",
  PAUSED: "warn",
  DONE: "good",
  CANCELED: "neutral",
};

const ITEM_TONE: Record<GroupAddItemStatus, Tone> = {
  PENDING: "neutral",
  PROCESSING: "info",
  ADDED: "good",
  INVITED: "info",
  ALREADY_IN: "good",
  NO_WHATSAPP: "warn",
  SKIPPED: "neutral",
  LEFT_GROUP: "warn",
  ALREADY_INVITED: "warn",
  FAILED: "bad",
};

/** The order the summary lists the statuses in: what worked first, what is still to do last. */
const SUMMARY_ORDER: readonly GroupAddItemStatus[] = [
  "ADDED",
  "INVITED",
  "ALREADY_IN",
  "NO_WHATSAPP",
  "SKIPPED",
  "LEFT_GROUP",
  "ALREADY_INVITED",
  "FAILED",
  "PROCESSING",
  "PENDING",
];

const PAUSE_REASONS: readonly string[] = ["manual", "disconnected", "not_admin", "no_connection", "number_changed", "error"];
/** The pauses that say what has to happen for the round to go on (the rest explain themselves). */
const HINTED_PAUSES: readonly string[] = ["disconnected", "not_admin", "no_connection", "number_changed", "error"];
const WAIT_REASONS: readonly string[] = ["pace", "window", "cap", "unavailable"];

/** The statuses that, with no note for their reason, still get a line saying what they mean (the others say it by their name). */
const EXPLAINED_STATUSES: ReadonlySet<GroupAddItemStatus> = new Set([
  "INVITED",
  "NO_WHATSAPP",
  "LEFT_GROUP",
  "ALREADY_INVITED",
  "FAILED",
]);

type Notice = { warn: boolean; text: string; hint: string | null };

/**
 * The tracking screen of a round of "Adicionar a grupo do WhatsApp": the state, why it is paused or waiting, how far it got,
 * a line per contact, and the buttons for who may steer it. It re-reads the page every 5 s while the round goes on
 * (AutoRefresh), and asks the server once, on opening, to take up a round that was waiting (pokeGroupAddAction): that is
 * what continues it where no cron is scheduled. Everything is told from the props; no clock is read while rendering.
 */
export function GroupAddRun(props: GroupAddRunProps) {
  const { runId, groupName, status, pausedReason, unreadable, waitReason, counts, items, canSteer } = props;
  const t = useTranslations("crm.groupAdd");
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, start] = useTransition();

  const open = status === "QUEUED" || status === "RUNNING" || status === "PAUSED";

  // Once, when the page opens. Never on a refresh tick: the poke of a round paused for a lost number asks Evolution for it.
  // The ref keeps the dev double-mount from poking twice. Afterwards the page is read again once, to show what the poke did.
  const poked = useRef(false);
  useEffect(() => {
    if (!open || poked.current) return;
    poked.current = true;
    pokeGroupAddAction(runId)
      .then(() => router.refresh())
      .catch(() => {});
  }, [open, runId, router]);

  async function act(kind: "pause" | "resume" | "cancel") {
    // Ask first, outside the transition: React 19 holds the state updates made at the start of an async transition until it
    // ends, so a dialog opened inside it never shows, and the transition never ends because it waits for the answer (the
    // buttons stay shut for good). Same order as the signature card.
    if (kind === "cancel") {
      const sure = await confirm({
        description: t("run.confirmCancel"),
        confirmLabel: t("run.confirmCancelYes"),
        cancelLabel: t("run.keep"),
        variant: "danger",
      });
      if (!sure) return;
    }
    start(async () => {
      try {
        const call = kind === "pause" ? pauseGroupAddAction : kind === "resume" ? resumeGroupAddAction : cancelGroupAddAction;
        const result = await call(runId);
        if (result.ok) toast(t(`run.toast.${kind}`));
        else toast(t(`error.${result.error}`), { variant: "error" });
      } catch {
        toast(t("error.unknown"), { variant: "error" });
      }
      // Inside a transition of its own, so the buttons stay shut until the new state is on screen.
      start(() => router.refresh());
    });
  }

  const total = SUMMARY_ORDER.reduce((n, s) => n + counts[s], 0);
  const done = total - counts.PENDING - counts.PROCESSING;
  const now = new Date(props.now);
  // The date and the time are formatted apart and joined here: the glue Intl puts between them (a space, a comma) has changed
  // between versions of its data, and this markup is rendered on the server and again in the browser, which must agree.
  const when = (iso: string) => {
    const at = new Date(iso);
    const date = format.dateTime(at, { dateStyle: "short", timeZone: GROUP_ADD_TIME_ZONE });
    const time = format.dateTime(at, { timeStyle: "short", timeZone: GROUP_ADD_TIME_ZONE });
    return `${date} ${time}`;
  };

  // Why the round is not simply going: a pause (with what to do about it), or a wait.
  let notice: Notice | null = null;
  if (status === "PAUSED") {
    const reason = pausedReason !== null && PAUSE_REASONS.includes(pausedReason) ? pausedReason : "other";
    const key = reason === "not_admin" && unreadable ? "unreadable" : reason === "manual" && !canSteer ? "manualOther" : reason;
    notice = {
      warn: true,
      text: t(`run.paused.${key}`),
      hint: HINTED_PAUSES.includes(key) ? t(`run.pausedHint.${key}`) : null,
    };
  } else if (status === "QUEUED") {
    notice = { warn: false, text: t("run.wait.queued"), hint: null };
  } else if (status === "RUNNING" && waitReason !== null && WAIT_REASONS.includes(waitReason)) {
    notice = {
      warn: false,
      text: t(`run.wait.${waitReason}`, { hour: GROUP_ADD_WINDOW.startHour, cap: GROUP_ADD_DAILY_CAP }),
      hint: null,
    };
  }

  const itemLabel = (s: GroupAddItemStatus) => t(`item.${s === "PENDING" && status === "CANCELED" ? "NOT_TRIED" : s}`);
  const noteOf = (item: GroupAddRunProps["items"][number]): string | null => {
    const note = item.reason ? reasonNote(item.reason) : null;
    if (note) return t(`reason.${note.key}`, { max: format.number(WHATSAPP_GROUP_MAX), code: note.code ?? "" });
    return EXPLAINED_STATUSES.has(item.status) ? t(`itemHint.${item.status}`) : null;
  };

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={status === "QUEUED" || status === "RUNNING"} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Link href="/app/contacts" className="inline-flex items-center gap-1 hover:underline">
              <ArrowLeft className="size-3.5" />
              {t("run.crumb")}
            </Link>
            <span aria-hidden>·</span>
            <span>{t("run.kicker")}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight">{groupName}</h1>
            <Chip tone={RUN_TONE[status]} label={t(`run.status.${status}`)} />
          </div>
          {props.startedAt ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("run.startedAt", { date: when(props.startedAt) })}
              {props.finishedAt ? ` · ${t("run.finishedAt", { date: when(props.finishedAt) })}` : ""}
            </p>
          ) : null}
        </div>

        {canSteer && open ? (
          <div className="flex flex-wrap items-center gap-2">
            {status === "PAUSED" ? (
              <Button type="button" size="sm" disabled={busy} onClick={() => act("resume")}>
                <Play className="size-4" />
                {t("run.resume")}
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act("pause")}>
                <Pause className="size-4" />
                {t("run.pause")}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act("cancel")} className="text-red-600 hover:text-red-700">
              <Ban className="size-4" />
              {t("run.cancel")}
            </Button>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div
          className={cn(
            "rounded-xl border px-5 py-3 text-sm",
            notice.warn ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          <p className={notice.warn ? "font-medium" : undefined}>{notice.text}</p>
          {notice.hint ? <p className="mt-1 text-muted-foreground">{notice.hint}</p> : null}
        </div>
      ) : null}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="font-semibold tabular-nums">{t("run.progress", { done: format.number(done), total: format.number(total) })}</p>
          {status === "RUNNING" && props.forecastAt ? (
            <p className="text-sm text-muted-foreground">{t("forecast", forecastValues(format, new Date(props.forecastAt), now))}</p>
          ) : null}
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          {SUMMARY_ORDER.filter((s) => s !== "PENDING" && counts[s] > 0).map((s) => (
            <div key={s} className={TONE_BAR[ITEM_TONE[s]]} style={{ width: total ? `${(counts[s] / total) * 100}%` : "0%" }} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SUMMARY_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <div key={s} className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-xs text-muted-foreground">{itemLabel(s)}</span>
              <span className="text-xl font-bold tabular-nums">{format.number(counts[s])}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("run.col.contact")}</th>
                <th className="px-5 py-3 font-medium">{t("run.col.status")}</th>
                <th className="hidden px-5 py-3 font-medium sm:table-cell">{t("run.col.when")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const note = noteOf(item);
                return (
                  <tr key={item.contactId} className="border-b border-border last:border-0">
                    <td className="max-w-[16rem] px-5 py-3 font-medium">
                      <span className="block truncate">{item.contactName}</span>
                    </td>
                    <td className="px-5 py-3">
                      <Chip tone={ITEM_TONE[item.status]} label={itemLabel(item.status)} />
                      {note ? <div className="mt-1 max-w-sm text-xs text-muted-foreground">{note}</div> : null}
                    </td>
                    <td className="hidden whitespace-nowrap px-5 py-3 text-muted-foreground sm:table-cell">
                      {item.processedAt ? when(item.processedAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Chip({ tone, label }: { tone: Tone; label: string }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONE_CHIP[tone])}>{label}</span>;
}
