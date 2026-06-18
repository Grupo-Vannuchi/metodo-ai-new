"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { startConversation } from "@/app/actions/inbox";
import { cn } from "@/lib/utils";

/** Opens (or creates) the WhatsApp conversation for a contact/company number.
 * `iconOnly` renders a compact icon button for cards/lists. */
export function StartChatButton({
  phone,
  name,
  contactId,
  iconOnly,
}: {
  phone: string;
  name?: string;
  contactId?: string;
  iconOnly?: boolean;
}) {
  const t = useTranslations("inbox");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      setError(null);
      const r = await startConversation({ phone, name, contactId });
      if (r.ok) router.push(`/app/inbox?c=${r.conversationId}`);
      else setError(t(`startError.${r.error}`));
    });

  if (iconOnly) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={run}
        title={t("chatOnWhatsapp")}
        aria-label={t("chatOnWhatsapp")}
        className="inline-flex items-center rounded-lg px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-green-600 disabled:opacity-50"
      >
        <MessageCircle className="size-4" />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <MessageCircle className="size-4" />
        {t("chatOnWhatsapp")}
      </button>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
