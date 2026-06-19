import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { MessageCircle, ArrowRight } from "lucide-react";
import { requireOrgContext } from "@/lib/tenant";
import { getContact } from "@/lib/queries/contacts";
import { companyOptions as companiesList } from "@/lib/queries/companies";
import { getConversationByContact } from "@/lib/queries/inbox";
import { listTasks } from "@/lib/queries/tasks";
import { listMembers } from "@/lib/queries/organizations";
import { ContactForm } from "@/components/crm/contact-form";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import { TasksManager } from "@/components/tasks/tasks-manager";
import { contactToForm } from "@/lib/contact-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: rawLocale, id } = await params;
  const locale = resolveLocale(rawLocale);
  const ctx = await requireOrgContext(locale);
  const t = await getTranslations("crm.contacts");
  const ti = await getTranslations("inbox");

  const [contact, companies, conversation, tasks, members] = await Promise.all([
    getContact(ctx.organizationId, id),
    companiesList(ctx.organizationId),
    getConversationByContact(ctx.organizationId, id),
    listTasks(ctx.organizationId, { contactId: id }),
    listMembers(ctx.organizationId),
  ]);
  if (!contact) notFound();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("editTitle")}</h1>
        {contact.phone ? (
          <StartChatButton phone={contact.phone} name={contact.name} contactId={contact.id} />
        ) : null}
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

      <ContactForm
        mode="edit"
        contactId={contact.id}
        defaultValues={contactToForm(contact)}
        companies={companies}
      />

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
