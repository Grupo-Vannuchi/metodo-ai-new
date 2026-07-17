import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/tenant";
import { getTask } from "@/lib/queries/tasks";
import { TaskDoneButton } from "@/components/tasks/task-done-button";
import { TaskDetail } from "@/components/tasks/task-detail";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function TaskViewPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("tasks");

  const task = await getTask(ctx.organizationId, id);
  if (!task) notFound();

  const done = task.done;
  const overdue = task.overdue;
  const inProgress = !done && task.status === "IN_PROGRESS";
  const fmt = (d: Date | null) =>
    d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  const fields = [
    { label: t("field.status"), value: t(`status.${task.status}`) },
    { label: t("field.type"), value: t(`type.${task.type}`) },
    { label: t("field.priority"), value: t(`priority.${task.priority}`) },
    { label: t("field.startDate"), value: fmt(task.startDate) },
    { label: t("field.dueDate"), value: fmt(task.dueDate) },
    { label: t("field.reminder"), value: fmt(task.reminderAt) },
    { label: t("field.recurrence"), value: t(`recurrence.${task.recurrence}`) },
    { label: t("field.assignee"), value: task.assignedToName ?? "—" },
    { label: t("field.createdBy"), value: task.createdByName ?? "—" },
  ];

  const statusLabel = done ? t("statusDone") : overdue ? t("statusOverdue") : inProgress ? t("status.IN_PROGRESS") : t("statusOpen");
  const statusCls = done
    ? "bg-green-500/10 text-green-600"
    : overdue
      ? "bg-red-500/10 text-red-600"
      : inProgress
        ? "bg-amber-500/10 text-amber-600"
        : "bg-brand/10 text-brand";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{task.title}</h1>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusCls)}>{statusLabel}</span>
        </div>
        <TaskDoneButton id={task.id} done={done} />
      </div>

      <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="mt-0.5 text-sm">{f.value}</dd>
          </div>
        ))}
        {task.opportunityId ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("field.opportunity")}</dt>
            <dd className="mt-0.5 text-sm">
              <Link href={`/app/crm/${task.opportunityId}`} className="text-brand hover:underline">
                {task.opportunityCode ? `${task.opportunityCode} · ` : ""}{task.opportunityTitle}
              </Link>
            </dd>
          </div>
        ) : null}
        {task.contactId ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("field.contact")}</dt>
            <dd className="mt-0.5 text-sm">
              <Link href={`/app/contacts/${task.contactId}`} className="text-brand hover:underline">
                {task.contactName ?? "—"}
              </Link>
            </dd>
          </div>
        ) : null}
        {task.companyId ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("field.company")}</dt>
            <dd className="mt-0.5 text-sm">
              <Link href={`/app/companies/${task.companyId}`} className="text-brand hover:underline">
                {task.companyName ?? "—"}
              </Link>
            </dd>
          </div>
        ) : null}
        {task.description ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("field.description")}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm">{task.description}</dd>
          </div>
        ) : null}
      </dl>

      <TaskDetail
        taskId={task.id}
        status={task.status as "TODO" | "IN_PROGRESS" | "DONE"}
        progress={task.progress}
        checklist={task.checklist}
        attachments={task.attachments.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, url: a.url }))}
      />
    </div>
  );
}
