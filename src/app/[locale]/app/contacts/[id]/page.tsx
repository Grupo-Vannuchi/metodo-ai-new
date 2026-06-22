import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { MessageCircle, ArrowRight, Pencil } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getContact } from "@/lib/queries/contacts";
import { getConversationByContact } from "@/lib/queries/inbox";
import { listTasks } from "@/lib/queries/tasks";
import { listMembers } from "@/lib/queries/organizations";
import { getEntityFinance } from "@/lib/queries/finance";
import { hasFeature, type PlanKey } from "@/config/plans";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { EntityFinanceCard } from "@/components/finance/entity-finance-card";
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

  const canFinance = hasFeature(ctx.organization.plan as PlanKey, "finance");
  const [contact, conversation, rawMembers, tasks, finance] = await Promise.all([
    getContact(ctx.organizationId, id),
    getConversationByContact(ctx.organizationId, id),
    listMembers(ctx.organizationId),
    listTasks(ctx.organizationId, { contactId: id }),
    canFinance ? getEntityFinance(ctx.organizationId, { contactId: id }) : Promise.resolve(null),
  ]);

  const members = ctx.role === "MEMBER" ? rawMembers.filter(m => m.userId === ctx.userId) : rawMembers;

  if (!contact) notFound();

  const fmtDate = (d: Date | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");

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
          {contact.phone ? (
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

      <section className="rounded-xl border border-border bg-card p-5">
        <TasksManager
          tasks={tasks}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          fixed={{ contactId: contact.id }}
          currentUserId={ctx.userId}
        />
      </section>
    </div>
  );
}
