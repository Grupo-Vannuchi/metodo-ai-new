"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { searchCloudContacts, startCloudConversation } from "@/app/actions/inbox-oficial";
import { Modal } from "./modal";

type ContactHit = { id: string; name: string; phone: string | null };

/** Nova conversa por contato do CRM ou número digitado. */
export function NewConversationDialog({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (conversationId: string) => void;
}) {
  const t = useTranslations("inboxOficial.newChat");
  const tr = useTranslations("inboxOficial");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ContactHit[]>([]);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Busca com atraso; todo setState acontece dentro do timeout, nunca direto no efeito.
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      const hits = q.trim().length >= 2 ? await searchCloudContacts(q) : [];
      if (active) setResults(hits);
    }, 300);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [q]);

  async function start(input: { phone?: string; contactId?: string }) {
    setBusy(true);
    setError(null);
    try {
      const r = await startCloudConversation(input);
      if (r.ok) {
        setQ("");
        setPhone("");
        onStarted(r.conversationId);
      } else {
        setError(r.error === "invalid" ? t("invalid") : tr(`errors.${r.error}`, { detail: "" }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("title")} closeLabel={tr("close")}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
        <div>
          <Label htmlFor="nc-q">{t("searchContact")}</Label>
          <Input id="nc-q" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 ? (
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => start({ contactId: c.id })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <UserRound className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div>
          <Label htmlFor="nc-phone">{t("orPhone")}</Label>
          <div className="flex gap-2">
            <Input
              id="nc-phone"
              inputMode="tel"
              value={phone}
              placeholder={t("phonePlaceholder")}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Button
              type="button"
              className="h-auto"
              disabled={busy || phone.replace(/\D/g, "").length < 10}
              onClick={() => start({ phone })}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("start")}
            </Button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
