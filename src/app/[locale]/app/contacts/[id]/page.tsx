import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { MessageCircle, ArrowRight, Pencil } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getContact } from "@/lib/queries/contacts";
import { getConversationByContact } from "@/lib/queries/inbox";
import { listTasks } from "@/lib/queries/tasks";
import { listMembers } from "@/lib/queries/organizations";
import { getEntityFinance } from "@/lib/queries/finance";
import { listContactGroupAdds, type ContactGroupAdd } from "@/lib/queries/whatsapp-group-add";
import { hasFeatureByModules, hasModule } from "@/config/modules";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { EntityFinanceCard } from "@/components/finance/entity-finance-card";
import { GROUP_ADD_TIME_ZONE } from "@/components/crm/group-add-format";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ContactViewPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.contacts");
  const ti = await getTranslations("inbox");
  const tg = await getTranslations("crm.groupAdd.contact");
  const format = await getFormatter();

  const canFinance = hasFeatureByModules(ctx.modules, "finance");
  const canInbox = hasModule(ctx.modules, "inbox");
  const canTasks = hasModule(ctx.modules, "tasks");
  const [contact, conversation, rawMembers, tasks, finance, groupAdds] = await Promise.all([
    getContact(ctx.organizationId, id),
    canInbox ? getConversationByContact(ctx.organizationId, id, ctx.userId) : Promise.resolve(null),
    listMembers(ctx.organizationId),
    canTasks ? listTasks(ctx.organizationId, { contactId: id }) : Promise.resolve([]),
    canFinance ? getEntityFinance(ctx.organizationId, { contactId: id }) : Promise.resolve(null),
    // The rounds of "Adicionar a grupo do WhatsApp" the contact was in: the number is the one of Conversas, so same module.
    canInbox ? listContactGroupAdds(ctx.organizationId, id) : Promise.resolve([]),
  ]);

  const members = ctx.role === "MEMBER" ? rawMembers.filter(m => m.userId === ctx.userId) : rawMembers;

  if (!contact) notFound();

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

  // One line per round of "Adicionar a grupo do WhatsApp" the contact was in, e.g. "Adicionado ao grupo Ofertas da Semana em
  // 28/10 por Fulano". The date is São Paulo's (the day of the round), with the year only when it is not this one. The name
  // comes from the team (all of it: `members` above is cut to the viewer for the tasks); no name if the person has left.
  const yearOf = (d: Date) => format.dateTime(d, { year: "numeric", timeZone: GROUP_ADD_TIME_ZONE });
  const thisYear = yearOf(new Date());
  const groupDate = (d: Date) =>
    format.dateTime(d, {
      day: "2-digit",
      month: "2-digit",
      ...(yearOf(d) === thisYear ? {} : { year: "numeric" as const }),
      timeZone: GROUP_ADD_TIME_ZONE,
    });
  const teamNames = new Map(rawMembers.map((m) => [m.userId, m.name]));
  const groupLine = (g: ContactGroupAdd): string => {
    // A person still waiting in a canceled round was never reached.
    const unreached = g.status === "PENDING" || g.status === "PROCESSING";
    const key = unreached ? (g.runStatus === "CANCELED" ? "NOT_TRIED" : "PENDING") : g.status;
    const date = groupDate(g.processedAt ?? g.runCreatedAt);
    const who = teamNames.get(g.createdById);
    return `${tg(`line.${key}`, { group: g.groupName })} ${who ? tg("whenBy", { date, who }) : tg("when", { date })}`;
  };

  const fields: { label: string; value: string }[] = [
    { label: t("email"), value: contact.email || "—" },
    { label: t("phone"), value: contact.phone || "—" },
    { label: t("role"), value: contact.role || "—" },
    { label: t("company"), value: contact.company?.name ?? "—" },
    { label: t("tags"), value: contact.tags.length ? contact.tags.join(", ") : "—" },
    { label: t("optedOut"), value: contact.optedOut ? t("optedOutYes") : t("optedOutNo") },
    { label: t("source"), value: contact.source || "—" },
    { label: t("createdAt"), value: fmtDate(contact.createdAt) },
  ];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{contact.name}</h1>
          {contact.company?.name ? (
            <p className="mt-1 text-sm text-muted-foreground">{contact.company.name}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canInbox && contact.phone ? (
            <StartChatButton phone={contact.phone} name={contact.name} contactId={contact.id} />
          ) : null}
          <Link href={`/app/contacts/${contact.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Pencil className="size-4" />
            {t("edit")}
          </Link>
        </div>
      </div>

      {conversation ? (
        <Link
          href={`/app/inbox?c=${conversation.id}`}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand/40"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <MessageCircle className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{ti("conversationTitle")}</p>
            <p className="truncate text-xs text-muted-foreground">
              {conversation.lastMessagePreview ?? ti("noMessages")}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm text-brand">
            {ti("openConversation")}
            <ArrowRight className="size-4" />
          </span>
        </Link>
      ) : null}

      <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="mt-0.5 text-sm">{f.value}</dd>
          </div>
        ))}
      </dl>

      {finance ? <EntityFinanceCard data={finance} /> : null}

      {canTasks ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <TasksManager
            tasks={tasks}
            members={members.map((m) => ({ id: m.userId, name: m.name }))}
            fixed={{ contactId: contact.id }}
            currentUserId={ctx.userId}
          />
        </section>
      ) : null}

      {canInbox && groupAdds.length > 0 ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">{tg("title")}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {groupAdds.map((g) => (
              <li key={g.runId}>
                <Link href={`/app/contacts/grupos/${g.runId}`} className="hover:underline">
                  {groupLine(g)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
