import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowRight, Mail, Send } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { listContactBroadcasts } from "@/lib/queries/contact-emails";
import { listInboxFrom, type MailboxResult } from "@/lib/email-broadcast/microsoft/inbox";
import { listImapInboxFrom } from "@/lib/email-broadcast/imap/inbox";
import { microsoftMailConfigured } from "@/lib/email-broadcast/microsoft/oauth";
import { inboxHref, type InboxMessageSummary, type MailboxChannel } from "@/lib/email-broadcast/microsoft/inbox-core";

/** E-mails of each mailbox shown on the page; the full list is one click away in the inbox. */
const INBOX_LIMIT = 5;
const BROADCAST_LIMIT = 10;

type InboxBlock = { channel: MailboxChannel; result: MailboxResult<InboxMessageSummary[]> };

/** The mass e-mails, or null when the database couldn't answer now: the section says so, the rest of the page stands. */
async function readBroadcasts(organizationId: string, contactId: string, address: string | null) {
  try {
    return await listContactBroadcasts(organizationId, contactId, address, BROADCAST_LIMIT);
  } catch (error) {
    console.error("[contact-emails] broadcasts failed", error);
    return null;
  }
}

/** A mailbox that throws (a bug, a dropped connection the module didn't catch) is a "try again", never a broken page. */
async function readInbox(channel: MailboxChannel, run: () => Promise<MailboxResult<InboxMessageSummary[]>>): Promise<InboxBlock> {
  try {
    return { channel, result: await run() };
  } catch (error) {
    console.error(`[contact-emails] ${channel} inbox failed`, error);
    return { channel, result: { ok: false, reason: "temporary" } };
  }
}

/**
 * "E-mails" on the contact's page (request: e-mail in the contact's history): the e-mails the company's mailbox received from
 * the contact's address, per connected mailbox (Microsoft, and the SMTP account's IMAP), each opening in the E-mail inbox; and
 * the mass e-mails the contact was in, each opening its report. The page decides who sees it (the E-mail screen and the
 * Marketing module) and `showInbox` (the Inbox screen too). A mailbox that isn't connected doesn't show; one that can't be
 * read now says so. Rendered inside a Suspense: a slow mailbox never holds the rest of the page.
 *
 * The mailboxes are read only when asked (`loadInbox`, the page's `?caixa=1`, behind a button): every read is a new IMAP
 * login, and a contact's page is opened far more often than the inbox tab; a provider that caps logins could lock the same
 * account the mass e-mails go out from. The mass e-mails are the database only, so they always show.
 */
export async function ContactEmails({
  organizationId,
  contactId,
  email,
  showInbox,
  loadInbox,
}: {
  organizationId: string;
  contactId: string;
  email: string | null;
  showInbox: boolean;
  loadInbox: boolean;
}) {
  const t = await getTranslations("crm.contacts.emails");
  const format = await getFormatter();
  const address = email?.trim().toLowerCase() || null;
  const readMailboxes = showInbox && loadInbox && address !== null;

  const [broadcasts, ...inboxes] = await Promise.all([
    readBroadcasts(organizationId, contactId, address),
    ...(readMailboxes && microsoftMailConfigured()
      ? [readInbox("microsoft", () => listInboxFrom(organizationId, address, INBOX_LIMIT))]
      : []),
    ...(readMailboxes ? [readInbox("smtp", () => listImapInboxFrom(organizationId, address, INBOX_LIMIT))] : []),
  ]);
  // A mailbox the company never connected (or an SMTP account without IMAP) is simply not there.
  const shown = inboxes.filter((b) => b.result.ok || b.result.reason !== "no_account");

  const when = (d: Date | string) => format.dateTime(new Date(d), { day: "2-digit", month: "2-digit", year: "2-digit" });

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold">{t("title")}</h2>

      {showInbox ? (
        <div className="mb-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Mail className="size-3.5" />
            {t("inboxTitle")}
          </h3>
          {address === null ? (
            <p className="text-sm text-muted-foreground">{t("noEmail")}</p>
          ) : !loadInbox ? (
            <Link
              href={`/app/contacts/${contactId}?caixa=1`}
              scroll={false}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-brand/40 hover:text-brand"
            >
              <Mail className="size-4" />
              {t("inboxLoad")}
            </Link>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMailbox")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {shown.map(({ channel, result }) => (
                <div key={channel}>
                  {shown.length > 1 ? (
                    <p className="mb-1 text-xs text-muted-foreground">
                      {channel === "microsoft" ? t("channelMicrosoft") : t("channelSmtp")}
                    </p>
                  ) : null}
                  {!result.ok ? (
                    <p className="text-sm text-muted-foreground">
                      {result.reason === "reconnect" ? t("inboxReconnect") : t("inboxError")}
                    </p>
                  ) : result.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("inboxEmpty")}</p>
                  ) : (
                    <>
                      <ul className="flex flex-col gap-1.5 text-sm">
                        {result.data.map((m) => (
                          <li key={m.id} className="flex items-baseline gap-2">
                            {m.isRead ? null : (
                              <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-brand" title={t("unread")} />
                            )}
                            <Link
                              href={inboxHref({ canal: channel, msg: m.id })}
                              className={`min-w-0 flex-1 truncate hover:underline ${m.isRead ? "" : "font-medium"}`}
                            >
                              {m.subject || t("noSubject")}
                            </Link>
                            <span className="shrink-0 text-xs text-muted-foreground">{when(m.receivedAt)}</span>
                          </li>
                        ))}
                      </ul>
                      <Link
                        href={inboxHref({ canal: channel, q: address })}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
                      >
                        {t("seeAll")}
                        <ArrowRight className="size-3" />
                      </Link>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Send className="size-3.5" />
          {t("broadcastsTitle")}
        </h3>
        {broadcasts === null ? (
          <p className="text-sm text-muted-foreground">{t("broadcastsError")}</p>
        ) : broadcasts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("broadcastsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {broadcasts.map((b) => (
              <li key={b.broadcastId} className="flex items-baseline gap-2">
                <Link href={`/app/email/${b.broadcastId}`} className="min-w-0 flex-1 truncate hover:underline">
                  {b.subject || t("noSubject")}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t(`status.${b.status}`)} · {when(b.sentAt ?? b.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** What shows while the mailboxes are read. */
export async function ContactEmailsSkeleton() {
  const t = await getTranslations("crm.contacts.emails");
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-busy="true">
      <h2 className="mb-3 text-sm font-semibold">{t("title")}</h2>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <p className="sr-only">{t("loading")}</p>
    </section>
  );
}
