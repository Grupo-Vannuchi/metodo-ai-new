import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { Inbox, Send } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { emailListHref } from "@/lib/email-broadcast/list-channel";
import { inboxHref, type MicrosoftTab } from "@/lib/email-broadcast/microsoft/inbox-core";
import { UnreadBadge } from "@/components/email/inbox/unread-badge";
import { cn } from "@/lib/utils";

/** "Envios" | "Caixa de entrada" on the Microsoft channel page. Shown only to members with the inbox screen. */
export function MicrosoftTabs({ active, unread }: { active: MicrosoftTab; unread: Promise<number | null> | null }) {
  const t = useTranslations("emailBroadcast.inbox");
  const tab = (on: boolean) =>
    cn(
      "-mb-px inline-flex h-11 items-center gap-2 border-b-2 px-3.5 text-sm font-medium transition-colors",
      on ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-1 border-b border-border">
      <Link href={emailListHref("microsoft")} aria-current={active === "envios" ? "page" : undefined} className={tab(active === "envios")}>
        <Send aria-hidden="true" className="size-4" />
        {t("tabSends")}
      </Link>
      <Link href={inboxHref()} aria-current={active === "caixa" ? "page" : undefined} className={tab(active === "caixa")}>
        <Inbox aria-hidden="true" className="size-4" />
        {t("tabInbox")}
        {unread ? (
          <Suspense fallback={null}>
            <UnreadBadge count={unread} />
          </Suspense>
        ) : null}
      </Link>
    </nav>
  );
}
