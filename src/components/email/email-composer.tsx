"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import { RecipientPicker } from "@/components/email/recipient-picker";
import { AudienceSummary } from "@/components/email/audience-summary";
import {
  previewEmailAudience,
  saveEmailDraft,
  sendEmailTest,
  startEmailBroadcast,
  type EmailActionFail,
} from "@/app/actions/email-broadcasts";
import type { AudiencePreview, ComposerDraft, ComposerOptions } from "@/lib/email-broadcast/types";

/** New/edit screen of a mass e-mail: message on the left, recipients + summary on the right. */
export function EmailComposer({
  draft,
  options,
  fromEmail,
  userEmail,
  quota,
}: {
  draft: ComposerDraft;
  options: ComposerOptions;
  fromEmail: string | null;
  userEmail: string;
  quota: { used: number; limit: number };
}) {
  const t = useTranslations("emailBroadcast");
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [id, setId] = useState<string | null>(draft.id);
  const [fromName, setFromName] = useState(draft.fromName);
  const [replyTo, setReplyTo] = useState(draft.replyTo);
  const [subject, setSubject] = useState(draft.subject);
  const [html, setHtml] = useState(draft.html);
  const [audience, setAudience] = useState(draft.audience);
  const [picked, setPicked] = useState(draft.picked);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [busy, startBusy] = useTransition();
  const noConnection = !fromEmail;

  // Live summary, debounced; state only changes inside the timeout.
  useEffect(() => {
    let active = true;
    const handle = setTimeout(async () => {
      const r = await previewEmailAudience(audience);
      if (active && r.ok) setPreview(r.preview);
    }, 350);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [audience]);

  const payload = () => ({ subject, html, fromName, replyTo, audience });
  const errorText = (r: EmailActionFail) =>
    r.error === "quota"
      ? t("error.quotaDetail", { total: r.total ?? 0, remaining: r.remaining ?? 0 })
      : (r.message ?? t(`error.${r.error}`));

  async function save(): Promise<string | null> {
    const r = await saveEmailDraft(id, payload());
    if (!r.ok) {
      toast(errorText(r), { variant: "error" });
      return null;
    }
    setId(r.id);
    return r.id;
  }

  function onSaveDraft() {
    startBusy(async () => {
      const savedId = await save();
      if (!savedId) return;
      toast(t("draftSaved"));
      if (!draft.id) router.replace(`/app/email/${savedId}/edit`);
    });
  }

  function onTest() {
    startBusy(async () => {
      const r = await sendEmailTest(payload());
      if (r.ok) toast(t("testSent", { email: r.to }));
      else toast(errorText(r), { variant: "error" });
    });
  }

  function onSend() {
    startBusy(async () => {
      const savedId = await save();
      if (!savedId) return;
      const p = await previewEmailAudience(audience);
      if (!p.ok) {
        toast(errorText(p), { variant: "error" });
        return;
      }
      const s = p.preview.stats;
      if (s.total === 0) {
        toast(t("error.empty"), { variant: "error" });
        return;
      }
      const ok = await confirm({
        title: t("confirmTitle", { count: s.total }),
        description: t("confirmBody", {
          subject: subject || t("noSubject"),
          duplicates: s.duplicates,
          suppressed: s.suppressed,
          invalid: s.invalid,
        }),
        confirmLabel: t("confirmSend", { count: s.total }),
      });
      if (!ok) return;
      const r = await startEmailBroadcast(savedId);
      if (!r.ok) {
        toast(errorText(r), { variant: "error" });
        return;
      }
      router.push(`/app/email/${savedId}`);
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">{t("message")}</h2>
        {noConnection ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {t("connection.missingBody")}{" "}
            <Link href="/app/connections/new" className="font-medium underline underline-offset-4">
              {t("connection.connect")}
            </Link>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fromName">{t("fromName")}</Label>
            <Input id="fromName" value={fromName} maxLength={100} onChange={(e) => setFromName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fromEmail">{t("fromEmail")}</Label>
            <Input id="fromEmail" value={fromEmail ?? ""} readOnly placeholder={t("connection.missingTitle")} />
          </div>
        </div>
        <div>
          <Label htmlFor="replyTo">
            {t("replyTo")} <span className="font-normal text-muted-foreground">{t("optional")}</span>
          </Label>
          <Input id="replyTo" type="email" value={replyTo} maxLength={254} onChange={(e) => setReplyTo(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="subject">{t("subject")}</Label>
          <Input id="subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">
            {t("variablesHint")} <code>{"{{nome}}"}</code> <code>{"{{empresa}}"}</code>
          </p>
        </div>
        <div>
          {/* Not a <label>: the TipTap editor isn't a form control it could point at. */}
          <p className="mb-1.5 text-sm font-medium">{t("body")}</p>
          <RichTextEditor
            value={html}
            onChange={setHtml}
            placeholder={t("bodyPlaceholder")}
            minHeight="16rem"
            variables={[
              { token: "nome", label: t("varName") },
              { token: "empresa", label: t("varCompany") },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("footerNotice")} {t("emptyVarHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={onTest} disabled={busy || noConnection}>
            <Send className="size-4" />
            {t("sendTest")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("testTo", { email: userEmail })}</span>
        </div>
      </section>

      <div className="flex flex-col gap-6">
        <RecipientPicker
          options={options}
          audience={audience}
          onAudienceChange={setAudience}
          picked={picked}
          onPickedChange={setPicked}
        />
        <AudienceSummary preview={preview} quota={quota}>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" className="flex-1" onClick={onSaveDraft} disabled={busy}>
              {t("saveDraft")}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={onSend}
              disabled={busy || noConnection || preview?.stats.total === 0}
            >
              {busy ? t("working") : t("reviewSend")}
            </Button>
          </div>
        </AudienceSummary>
      </div>
    </div>
  );
}
