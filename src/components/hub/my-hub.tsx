"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  TrendingUp,
  AlertTriangle,
  CheckSquare,
  Star,
  X,
  Plus,
  Bell,
  ArrowRight,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { createTask } from "@/app/actions/tasks";
import { togglePin } from "@/app/actions/hub";
import { HubCalendar, dayKey } from "@/components/hub/hub-calendar";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { usePaged, Pager } from "@/components/ui/client-pager";
import type { TaskRow } from "@/lib/queries/tasks";
import type { HubOpportunity, HubNotification, HubPin } from "@/lib/queries/hub";

type Option = { id: string; name: string };
type TabKey = "tasks" | "opps" | "agenda" | "notifications";

export function MyHub({
  userName,
  currentUserId,
  todayISO,
  tasks,
  opps,
  notifications,
  pins,
  members,
  contacts,
  opportunities,
}: {
  userName: string;
  currentUserId: string;
  todayISO: string;
  tasks: TaskRow[];
  opps: HubOpportunity[];
  notifications: HubNotification[];
  pins: HubPin[];
  members: Option[];
  contacts: Option[];
  opportunities: Option[];
}) {
  const t = useTranslations("my");
  const [tab, setTab] = useState<TabKey>("agenda");
  const [day, setDay] = useState<string | null>(null);

  const todayKey = dayKey(new Date(todayISO));

  // ── Stats (personal) ──
  const stats = useMemo(() => {
    let dueToday = 0;
    let overdue = 0;
    for (const task of tasks) {
      if (task.doneAt || !task.dueDate) continue;
      const k = dayKey(new Date(task.dueDate));
      if (k === todayKey) dueToday++;
      else if (k < todayKey) overdue++;
    }
    const forecast = opps.reduce((s, o) => s + o.value, 0);
    return { dueToday, overdue, openOpps: opps.length, forecast };
  }, [tasks, opps, todayKey]);

  function selectDay(k: string | null) {
    setDay(k);
    if (k) setTab("agenda");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header + stats */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("hubTitle", { name: userName })}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        <QuickAddTask currentUserId={currentUserId} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={CalendarClock} label={t("statDueToday")} value={String(stats.dueToday)} />
        <Stat
          icon={AlertTriangle}
          label={t("statOverdue")}
          value={String(stats.overdue)}
          tone={stats.overdue > 0 ? "danger" : undefined}
        />
        <Stat icon={CheckSquare} label={t("statOpenOpps")} value={String(stats.openOpps)} />
        <Stat icon={TrendingUp} label={t("statForecast")} value={formatBRL(stats.forecast)} />
      </section>

      {/* Overdue / today highlight */}
      {stats.overdue > 0 || stats.dueToday > 0 ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-xl border p-4 text-sm",
            stats.overdue > 0
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
              : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300",
          )}
        >
          <AlertTriangle className="size-5 shrink-0" />
          <span className="flex-1">
            {stats.overdue > 0 ? t("alertOverdue", { count: stats.overdue }) : null}
            {stats.overdue > 0 && stats.dueToday > 0 ? " · " : null}
            {stats.dueToday > 0 ? t("alertToday", { count: stats.dueToday }) : null}
          </span>
          <button
            type="button"
            onClick={() => {
              selectDay(stats.overdue > 0 ? null : todayKey);
              setTab(stats.overdue > 0 ? "tasks" : "agenda");
            }}
            className="shrink-0 font-medium underline underline-offset-2"
          >
            {t("alertReview")}
          </button>
        </div>
      ) : null}

      {/* Pinned */}
      {pins.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Star className="size-4 text-amber-500" /> {t("pinned")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {pins.map((p) => (
              <PinChip key={p.pinId} pin={p} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Calendar + tabs */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <HubCalendar
          tasks={tasks}
          opps={opps}
          todayISO={todayISO}
          selectedKey={day}
          onSelectDay={selectDay}
        />

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
            <TabBtn active={tab === "agenda"} onClick={() => setTab("agenda")}>{t("tabAgenda")}</TabBtn>
            <TabBtn active={tab === "tasks"} onClick={() => setTab("tasks")}>{t("tabTasks")}</TabBtn>
            <TabBtn active={tab === "opps"} onClick={() => setTab("opps")}>{t("tabOpps")}</TabBtn>
            <TabBtn active={tab === "notifications"} onClick={() => setTab("notifications")}>
              {t("tabNotifications")}
            </TabBtn>
          </div>

          {tab === "agenda" ? (
            <AgendaTab tasks={tasks} opps={opps} todayKey={todayKey} day={day} clearDay={() => setDay(null)} />
          ) : null}

          {tab === "tasks" ? (
            <TasksManager
              tasks={tasks}
              members={members}
              contacts={contacts}
              opportunities={opportunities}
              currentUserId={currentUserId}
              showTabs
              pageSize={8}
            />
          ) : null}

          {tab === "opps" ? <OppsTab opps={opps} /> : null}

          {tab === "notifications" ? <NotificationsTab notifications={notifications} /> : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn("size-4", tone === "danger" ? "text-red-500" : "")} />
        <span className="text-sm">{label}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", tone === "danger" ? "text-red-600 dark:text-red-400" : "")}>
        {value}
      </p>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-brand text-brand"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function QuickAddTask({ currentUserId }: { currentUserId: string }) {
  const t = useTranslations("my");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || pending) return;
    const fd = new FormData();
    fd.set("title", title.trim());
    if (due) fd.set("dueDate", due);
    fd.set("assignedToId", currentUserId);
    start(async () => {
      const r = await createTask(fd);
      if (r.ok) {
        setTitle("");
        setDue("");
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
      >
        <Plus className="size-4" /> {t("quickAdd")}
      </button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("quickAddPlaceholder")}
        className="h-9 min-w-44 flex-1 rounded-md border border-border bg-card px-2.5 text-sm focus-visible:border-brand focus-visible:outline-none"
      />
      <input
        type="date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        className="h-9 rounded-md border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
      />
      <button
        type="submit"
        disabled={pending || !title.trim()}
        className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-foreground disabled:opacity-50"
      >
        {t("add")}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
        aria-label="Cancel"
      >
        <X className="size-4" />
      </button>
    </form>
  );
}

function PinChip({ pin }: { pin: HubPin }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-3 pr-1.5 text-sm">
      <Link href={pin.href} className="max-w-52 truncate font-medium hover:underline">
        {pin.label}
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await togglePin(pin.type, pin.entityId);
            router.refresh();
          })
        }
        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Unpin"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

// ── Agenda tab (date-ordered tasks + opps; day-filterable from the calendar) ──
type AgendaItem = { date: Date; kind: "task" | "opp"; id: string; title: string; meta: string; href: string };

function AgendaTab({
  tasks,
  opps,
  todayKey,
  day,
  clearDay,
}: {
  tasks: TaskRow[];
  opps: HubOpportunity[];
  todayKey: string;
  day: string | null;
  clearDay: () => void;
}) {
  const t = useTranslations("my");
  const locale = useLocale();
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "short" }),
    [locale],
  );

  const items = useMemo(() => {
    const list: AgendaItem[] = [];
    for (const task of tasks) {
      if (!task.dueDate || task.doneAt) continue;
      list.push({
        date: new Date(task.dueDate),
        kind: "task",
        id: task.id,
        title: task.title,
        meta: task.opportunityTitle ?? task.contactName ?? "",
        href: `/app/tasks/${task.id}`,
      });
    }
    for (const o of opps) {
      if (!o.expectedCloseDate) continue;
      list.push({
        date: new Date(o.expectedCloseDate),
        kind: "opp",
        id: o.id,
        title: o.title,
        meta: formatBRL(o.value),
        href: `/app/crm/${o.id}`,
      });
    }
    list.sort((a, b) => a.date.getTime() - b.date.getTime());
    if (day) return list.filter((i) => dayKey(i.date) === day);
    return list.filter((i) => dayKey(i.date) >= todayKey); // upcoming
  }, [tasks, opps, day, todayKey]);

  const { pageItems, page, setPage, totalPages } = usePaged(items, 8, day);

  return (
    <div className="flex flex-col gap-3">
      {day ? (
        <div className="flex items-center justify-between rounded-lg bg-brand/10 px-3 py-2 text-sm">
          <span className="font-medium text-brand">{fmt.format(new Date(`${day}T12:00:00`))}</span>
          <button type="button" onClick={clearDay} className="text-xs text-brand hover:underline">
            {t("clearDay")}
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <Empty>{day ? t("noDayItems") : t("noAgenda")}</Empty>
      ) : (
        <ul className="flex flex-col rounded-xl border border-border bg-card">
          {pageItems.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="border-b border-border last:border-0">
              <Link href={i.href} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted">
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase",
                    i.kind === "task" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-brand/15 text-brand",
                  )}
                >
                  {i.kind === "task" ? t("tagTask") : t("tagOpp")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.title}</span>
                  {i.meta ? <span className="block truncate text-xs text-muted-foreground">{i.meta}</span> : null}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmt.format(i.date)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}

function OppsTab({ opps }: { opps: HubOpportunity[] }) {
  const t = useTranslations("my");
  const { pageItems, page, setPage, totalPages } = usePaged(opps, 8);
  if (opps.length === 0) return <Empty>{t("noOpps")}</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col rounded-xl border border-border bg-card">
        {pageItems.map((o) => (
          <li key={o.id} className="border-b border-border last:border-0">
            <Link
              href={`/app/crm/${o.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted"
            >
              <span className="min-w-0">
                {o.code ? <span className="mr-2 text-xs tabular-nums text-muted-foreground">{o.code}</span> : null}
                <span className="font-medium">{o.title}</span>
                {o.stageName ? <span className="ml-2 text-xs text-muted-foreground">· {o.stageName}</span> : null}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-brand">{formatBRL(o.value)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}

function NotificationsTab({ notifications }: { notifications: HubNotification[] }) {
  const t = useTranslations("my");
  const locale = useLocale();
  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }), [locale]);
  const { pageItems, page, setPage, totalPages } = usePaged(notifications, 10);
  if (notifications.length === 0) return <Empty>{t("noNotifications")}</Empty>;
  return (
    <div className="flex flex-col gap-3">
    <ul className="flex flex-col rounded-xl border border-border bg-card">
      {pageItems.map((n) => {
        const data = n.data as { title?: string; actor?: string } | null;
        const typeLabel = t.has(`notif.${n.type}`) ? t(`notif.${n.type}`) : t("notifGeneric");
        const label = data?.title ?? typeLabel;
        const row = (
          <span className="flex items-center gap-3 px-4 py-3 text-sm">
            <Bell className={cn("size-4 shrink-0", n.readAt ? "text-muted-foreground" : "text-brand")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{label}</span>
              {data?.actor ? <span className="block truncate text-xs text-muted-foreground">{data.actor}</span> : null}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmt.format(new Date(n.createdAt))}</span>
            {n.link ? <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          </span>
        );
        return (
          <li key={n.id} className={cn("border-b border-border last:border-0", n.readAt ? "" : "bg-brand/5")}>
            {n.link ? (
              <Link href={n.link} className="block transition-colors hover:bg-muted">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
      <Pager page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
