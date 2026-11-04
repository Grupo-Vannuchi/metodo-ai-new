"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFormatter, useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, Users, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { startGroupAddAction } from "@/app/actions/whatsapp-group-add";
import { GROUP_ADD_MAX_CONTACTS } from "@/lib/whatsapp/group-add/core";
import type { GroupAddSource, GroupOption } from "@/lib/whatsapp/group-add/service";
import { Notice } from "@/components/crm/group-add-parts";
import { GroupPicker, fetchGroups, type GroupsState } from "@/components/crm/group-add-picker";
import { Review, fetchPreview, type PreviewState } from "@/components/crm/group-add-review";

/**
 * "Adicionar a grupo do WhatsApp": a portal modal (as the duplicates one) in two screens. First the member's own groups, with
 * a search box and the ones where their number is not admin shown but blocked (group-add-picker); then the review (the
 * counts, the notices, the invite text, the pace and the forecast: group-add-review) with the button that starts the round and
 * goes to its tracking page. `count` is how many contacts the source holds in the list the member sees. Everything that
 * decides something (who is admin, who is left out, what the number spent today) is the server's answer; this only shows it.
 */
export function GroupAddDialog({
  source,
  count,
  onClose,
}: {
  source: GroupAddSource;
  count: number;
  onClose: () => void;
}) {
  const t = useTranslations("crm.groupAdd");
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();
  const titleId = useId();
  const inviteId = useId();

  const [groups, setGroups] = useState<GroupsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<GroupOption | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ kind: "loading" });
  const [invite, setInvite] = useState(() => t("inviteDefault"));
  // "started" is the round made and the page on its way: the button stays shut until this dialog goes away with the page.
  const [phase, setPhase] = useState<"idle" | "starting" | "started">("idle");
  // Which review is the current one: an answer that arrives after the member changed group is dropped.
  const previewRequest = useRef(0);

  const busy = phase !== "idle";
  // A selection of more than a round takes is not sent anywhere (the action would refuse it): the dialog says so instead.
  const tooMany = source.kind === "contacts" && count > GROUP_ADD_MAX_CONTACTS;

  useEffect(() => {
    if (tooMany) return;
    let live = true;
    fetchGroups().then((next) => {
      if (live) setGroups(next);
    });
    return () => {
      live = false;
    };
  }, [attempt, tooMany]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  function retryGroups() {
    setGroups({ kind: "loading" });
    setAttempt((n) => n + 1);
  }

  function review(group: GroupOption) {
    const request = ++previewRequest.current;
    setChosen(group);
    setPreview({ kind: "loading" });
    fetchPreview(source, group.jid).then((next) => {
      if (request === previewRequest.current) setPreview(next);
    });
  }

  function backToGroups() {
    previewRequest.current++;
    setChosen(null);
  }

  async function begin() {
    if (!chosen || busy) return;
    setPhase("starting");
    try {
      const result = await startGroupAddAction({ source, groupJid: chosen.jid, inviteText: invite });
      if (result.ok) {
        setPhase("started");
        router.push(`/app/contacts/grupos/${result.runId}`);
        return;
      }
      toast(t(`error.${result.error}`), { variant: "error" });
    } catch {
      toast(t("error.unknown"), { variant: "error" });
    }
    setPhase("idle");
  }

  if (typeof document === "undefined") return null;

  const ready = chosen !== null && preview.kind === "ready" ? preview.preview : null;
  const canStart = ready !== null && ready.counts.pending > 0 && invite.trim().length > 0;

  let body: React.ReactNode;
  if (tooMany) {
    body = (
      <Notice icon={<AlertTriangle className="size-4" />}>
        {t("dialog.tooMany", { count: format.number(count), max: format.number(GROUP_ADD_MAX_CONTACTS) })}
      </Notice>
    );
  } else if (chosen === null) {
    body = <GroupPicker state={groups} query={query} onQuery={setQuery} onPick={review} onRetry={retryGroups} />;
  } else {
    body = <Review source={source} count={count} group={chosen} state={preview} invite={invite} inviteId={inviteId} onInvite={setInvite} />;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("dialog.close")}
        onClick={() => (busy ? null : onClose())}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm motion-safe:animate-overlay-in"
      />
      <div className="glass-strong relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 shadow-2xl motion-safe:animate-dialog-in">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Users className="size-5 shrink-0 text-brand" />
              <h2 id={titleId} className="text-base font-semibold">
                {t("dialog.title")}
              </h2>
            </div>
            {tooMany ? null : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {chosen === null ? t("dialog.subtitleGroup") : t("dialog.subtitleReview")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("dialog.close")}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{body}</div>

        {chosen !== null && !tooMany ? (
          <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={backToGroups}>
              <ArrowLeft className="size-4" />
              {t("dialog.change")}
            </Button>
            <Button type="button" size="sm" disabled={!canStart || busy} onClick={begin}>
              {busy ? <Spinner className="size-4" /> : null}
              {busy ? t("dialog.starting") : t("dialog.start")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
