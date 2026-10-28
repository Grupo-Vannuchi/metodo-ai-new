import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Download, MailOpen, Paperclip, Reply, UserRound } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { loadInboxView } from "@/lib/email-broadcast/microsoft/inbox";
import { loadImapInboxView } from "@/lib/email-broadcast/imap/inbox";
import {
  INBOX_PAGE_SIZE,
  inboxHref,
  matchReplyToSend,
  type InboxAddress,
  type InboxFilter,
  type InboxMessageDetail,
  type MailboxChannel,
  type ReplyMatch,
} from "@/lib/email-broadcast/microsoft/inbox-core";
import { crmContactsByEmail, mailboxSendsTo, type InboxCrmContact } from "@/lib/queries/email-inbox";
import type { SenderAccountView } from "@/lib/email-broadcast/types";
import { IMAP_MAX_MESSAGE_BYTES } from "@/lib/email-broadcast/imap/parse";
import { SenderAccountPanel } from "@/components/email/sender-account-panel";
import { InboxSearch } from "@/components/email/inbox/inbox-search";
import { InboxReply } from "@/components/email/inbox/inbox-reply";
import { LinkPending } from "@/components/email/inbox/link-pending";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FILTERS: InboxFilter[] = ["todas", "nao-lidas", "respostas"];

function senderLabel(a: InboxAddress, fallback: string): string {
  return a.name ?? a.email ?? fallback;
}

function initials(label: string): string {
  const words = label.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * The connected mailbox's Inbox inside E-mail (list + reading pane): the
 * Microsoft one, or the company's SMTP account read over IMAP. Server-rendered
 * from the mailbox on every request; nothing from it is stored. The CRM card shows only when the server says the member
 * can see contacts (`showCrm`).
 */
export async function EmailInbox({
  channel,
  organizationId,
  account,
  filter,
  search,
  messageId,
  showCrm,
}: {
  channel: MailboxChannel;
  organizationId: string;
  account: SenderAccountView;
  filter: InboxFilter;
  search: string;
  messageId: string | null;
  showCrm: boolean;
}) {
  const t = await getTranslations("emailBroadcast.inbox");
  const format = await getFormatter();
  const now = new Date();

  // One load for the list and the open e-mail: the mailbox takes few concurrent calls.
  const smtp = channel === "smtp";
  const load = smtp ? loadImapInboxView : loadInboxView;
  const view = await load(organizationId, { search, unreadOnly: filter === "nao-lidas", messageId });

  if (!view.ok) {
    if (view.reason === "reconnect" || view.reason === "no_account") {
      return (
        <div className="max-w-2xl">
          <SenderAccountPanel
            provider={smtp ? "SMTP" : "MICROSOFT"}
            account={account.status === "ACTIVE" ? { ...account, status: "NEEDS_RECONNECT" } : account}
          />
        </div>
      );
    }
    // A search the server refused. Without text it was the "Não lidas" filter (SMTP only): there are no words to change. The
    // filter is named here too, so this doesn't rest on that being the only search the server can refuse with no text.
    const refused = view.reason === "not_found";
    const filterRefused = refused && !search && filter === "nao-lidas";
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="text-sm">
          {refused && search ? t("searchFailed") : filterRefused && smtp ? t("filterFailed") : t("loadFailed")}
        </p>
        <Link
          href={inboxHref({ canal: channel, filtro: filterRefused && smtp ? "todas" : filter })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {filterRefused && smtp ? t("showAll") : t("tryAgain")}
        </Link>
      </div>
    );
  }

  const opened = view.data.detail;
  const detail: InboxMessageDetail | null = opened?.ok ? opened.data : null;
  // Already reflects the "read" mark of the open e-mail (shown read, one unread less).
  const { messages, unreadCount } = view.data.page;

  const senders = [...messages.map((m) => m.from.email), detail?.from.email ?? null];
  const [contacts, sends] = await Promise.all([
    showCrm ? crmContactsByEmail(organizationId, senders) : Promise.resolve(new Map<string, InboxCrmContact>()),
    mailboxSendsTo(organizationId, smtp ? "SMTP" : "MICROSOFT", senders),
  ]);
  const replyOf = (m: { from: InboxAddress; subject: string; receivedAt: string }): ReplyMatch | null =>
    matchReplyToSend({ fromEmail: m.from.email, subject: m.subject, receivedAt: new Date(m.receivedAt) }, sends);

  const rows = messages.map((m) => ({ ...m, reply: replyOf(m) }));
  const visible = filter === "respostas" ? rows.filter((r) => r.reply) : rows;

  const sameDay = (d: Date) => format.dateTime(d, { dateStyle: "short" }) === format.dateTime(now, { dateStyle: "short" });
  const shortWhen = (iso: string) => {
    const d = new Date(iso);
    if (sameDay(d)) return format.dateTime(d, { timeStyle: "short" });
    if (d.getFullYear() === now.getFullYear()) return format.dateTime(d, { day: "2-digit", month: "2-digit" });
    return format.dateTime(d, { dateStyle: "short" });
  };

  const emptyText = search ? t("emptySearch", { q: search }) : filter === "todas" ? t("empty") : t("emptyFilter");
  const listHref = inboxHref({ canal: channel, filtro: filter, q: search });

  return (
    <div className="flex min-h-[640px] flex-col overflow-hidden rounded-xl border border-border bg-card md:flex-row">
      <section
        aria-label={t("listLabel")}
        className={cn(
          "min-w-0 flex-col border-border md:flex md:w-[380px] md:shrink-0 md:border-r",
          messageId ? "hidden" : "flex",
        )}
      >
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <InboxSearch channel={channel} search={search} filter={filter} messageId={messageId} />
          <nav aria-label={t("filtersLabel")} className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link
                key={f}
                href={inboxHref({ canal: channel, filtro: f, q: search })}
                aria-current={f === filter ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full border pl-3 pr-2 text-[13px] font-medium transition-colors",
                  f === filter
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(`filter.${f}`)}
                <LinkPending className="size-3.5" />
              </Link>
            ))}
          </nav>
          <p className="text-xs text-muted-foreground">
            {t("mailbox", { email: account.email })} · {t("unreadCount", { count: unreadCount })}
          </p>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="flex-1 overflow-y-auto md:max-h-[720px]">
            {visible.map((m) => {
              const selected = m.id === messageId;
              const who = senderLabel(m.from, t("unknownSender"));
              return (
                <li key={m.id} className="border-b border-border last:border-0">
                  <Link
                    href={inboxHref({ canal: channel, filtro: filter, q: search, msg: m.id })}
                    prefetch={false}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex flex-col gap-1 px-4 py-3.5 text-sm transition-colors",
                      selected ? "bg-brand/10" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {m.isRead ? null : (
                        <>
                          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-brand" />
                          <span className="sr-only">{t("unread")}</span>
                        </>
                      )}
                      <span className={cn("min-w-0 flex-1 truncate", m.isRead ? "font-medium" : "font-bold")}>{who}</span>
                      <LinkPending className="size-3.5" />
                      <time dateTime={m.receivedAt} className="shrink-0 text-xs text-muted-foreground">
                        {shortWhen(m.receivedAt)}
                      </time>
                    </span>
                    <span className={cn("truncate", m.isRead ? null : "font-semibold")}>{m.subject || t("noSubject")}</span>
                    {m.preview ? <span className="truncate text-[13px] text-muted-foreground">{m.preview}</span> : null}
                    {m.reply || m.hasAttachments ? (
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5 pt-0.5">
                        {m.reply ? (
                          <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                            <Reply aria-hidden="true" className="size-3 shrink-0" />
                            <span className="truncate">{t("replyTag", { subject: m.reply.subject })}</span>
                          </span>
                        ) : null}
                        {m.hasAttachments ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Paperclip aria-hidden="true" className="size-3" />
                            {t("hasAttachment")}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {messages.length >= INBOX_PAGE_SIZE ? (
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {t("pageNote", { count: INBOX_PAGE_SIZE })}
          </p>
        ) : null}
      </section>

      <section
        aria-label={t("readerLabel")}
        className={cn("min-w-0 flex-1 flex-col gap-5 p-5 md:flex md:p-6", messageId ? "flex" : "hidden bg-muted/40")}
      >
        {messageId ? (
          <Link
            href={listHref}
            className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground md:hidden"
          >
            <ArrowLeft className="size-4" />
            {t("backToList")}
          </Link>
        ) : null}

        {!messageId ? (
          <div className="mx-auto mt-[12vh] flex max-w-xs flex-col items-center gap-3 text-center">
            <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-brand/10 text-brand">
              <MailOpen className="size-6" />
            </span>
            <p className="font-medium">{t("pickTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("pick")}</p>
          </div>
        ) : !detail ? (
          <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            {opened && !opened.ok && opened.reason === "not_found" ? t("messageGone") : t("messageFailed")}
          </p>
        ) : (
          <MessageView
            key={detail.id}
            channel={channel}
            detail={detail}
            mailbox={account.email}
            contact={detail.from.email ? (contacts.get(detail.from.email) ?? null) : null}
            showCrm={showCrm}
            reply={replyOf(detail)}
            when={format.dateTime(new Date(detail.receivedAt), { dateStyle: "medium", timeStyle: "short" })}
            sentOn={(d: Date) => format.dateTime(d, { dateStyle: "short" })}
            sizeOf={(bytes: number) =>
              bytes >= 1024 * 1024
                ? `${format.number(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`
                : `${format.number(Math.max(1, Math.round(bytes / 1024)))} KB`
            }
          />
        )}
      </section>
    </div>
  );
}

async function MessageView({
  channel,
  detail,
  mailbox,
  contact,
  showCrm,
  reply,
  when,
  sentOn,
  sizeOf,
}: {
  channel: MailboxChannel;
  detail: InboxMessageDetail;
  mailbox: string;
  contact: InboxCrmContact | null;
  showCrm: boolean;
  reply: ReplyMatch | null;
  when: string;
  sentOn: (d: Date) => string;
  sizeOf: (bytes: number) => string;
}) {
  const t = await getTranslations("emailBroadcast.inbox");
  const who = senderLabel(detail.from, t("unknownSender"));
  const list = (items: InboxAddress[]) => items.map((a) => a.email ?? a.name).filter(Boolean).join(", ");
  const newContactHref = `/app/contacts/new?${new URLSearchParams({
    name: detail.from.name ?? "",
    email: detail.from.email ?? "",
  }).toString()}`;

  return (
    <article className="flex flex-col gap-5">
      <h3 className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{detail.subject || t("noSubject")}</h3>

      <div className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand"
        >
          {initials(who)}
        </span>
        <div className="min-w-0 flex-1 basis-56 text-sm">
          <p className="font-semibold">{who}</p>
          {detail.from.name && detail.from.email ? (
            <p className="break-all text-muted-foreground">{detail.from.email}</p>
          ) : null}
          {detail.to.length > 0 ? <p className="text-muted-foreground [overflow-wrap:anywhere]">{t("to", { list: list(detail.to) })}</p> : null}
          {detail.cc.length > 0 ? <p className="text-muted-foreground [overflow-wrap:anywhere]">{t("cc", { list: list(detail.cc) })}</p> : null}
        </div>
        <time dateTime={detail.receivedAt} className="whitespace-nowrap text-sm text-muted-foreground">
          {when}
        </time>
      </div>

      {(showCrm && detail.from.email) || reply ? (
        <div className="flex flex-wrap gap-3">
          {showCrm && detail.from.email ? (
            contact ? (
              <div className="flex min-w-0 flex-1 basis-64 items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
                <UserRound aria-hidden="true" className="size-5 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{t("crmContact")}</p>
                  <p className="truncate text-sm font-medium">
                    {contact.companyName ? `${contact.name} · ${contact.companyName}` : contact.name}
                  </p>
                </div>
                <Link href={`/app/contacts/${contact.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("openCrm")}
                </Link>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 basis-64 items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
                <UserRound aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t("notInCrm")}</p>
                  <p className="text-xs text-muted-foreground">{t("notInCrmHint")}</p>
                </div>
                <Link href={newContactHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("addToCrm")}
                </Link>
              </div>
            )
          ) : null}
          {reply ? (
            <div className="flex min-w-0 flex-1 basis-64 items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <Reply aria-hidden="true" className="size-5 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{t("replyToSend")}</p>
                <p className="truncate text-sm font-medium">{reply.subject}</p>
                <p className="text-xs text-muted-foreground">{t("sentOn", { date: sentOn(reply.sentAt) })}</p>
              </div>
              <Link href={`/app/email/${reply.broadcastId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("viewSend")}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {detail.notice ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {t(detail.notice === "tooBig" ? "smtp.noticeTooBig" : "smtp.noticeUnreadable", {
            mb: IMAP_MAX_MESSAGE_BYTES / (1024 * 1024),
          })}
        </p>
      ) : (
        <iframe
          title={t("bodyTitle")}
          srcDoc={detail.bodyDocument}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className="h-[60vh] min-h-80 w-full rounded-lg border border-border bg-white"
        />
      )}

      {detail.attachments.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("attachments")}</p>
          <ul className="flex flex-wrap gap-2">
            {detail.attachments.map((a) => (
              <li key={a.id}>
                {a.downloadable ? (
                  <a
                    href={`/api/email/${channel}/attachment?${new URLSearchParams({ m: detail.id, a: a.id }).toString()}`}
                    download
                    className="inline-flex h-10 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm transition-colors hover:bg-muted"
                  >
                    <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="shrink-0 text-muted-foreground">{sizeOf(a.size)}</span>
                    <Download aria-hidden="true" className="size-4 shrink-0 text-brand" />
                    <span className="sr-only">{t("download")}</span>
                  </a>
                ) : (
                  <span className="inline-flex h-10 max-w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground">
                    <Paperclip aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">{a.name}</span>
                    <span className="shrink-0">{t("onlyInOutlook")}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <InboxReply channel={channel} messageId={detail.id} recipient={who} mailbox={mailbox} webLink={detail.webLink} />
    </article>
  );
}
