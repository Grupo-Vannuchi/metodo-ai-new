"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { isSenderAllowed } from "@/lib/email-broadcast/sender-domain";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import { useEmailImageSupport } from "@/components/email/use-email-image-support";
import { RecipientPicker } from "@/components/email/recipient-picker";
import { AudienceSummary } from "@/components/email/audience-summary";
import { EmailAttachments } from "@/components/email/email-attachments";
import { SignaturePreview } from "@/components/email/signature-preview";
import { estimateAttachmentSendMinutes } from "@/lib/email-broadcast/attachments";
import {
  previewEmailAudience,
  saveEmailDraft,
  startEmailBroadcast,
  type EmailActionFail,
} from "@/app/actions/email-broadcasts";
import type { AudiencePreview, ComposerDraft, ComposerOptions, SignatureOption } from "@/lib/email-broadcast/types";

/** New/edit screen of a mass e-mail: message on the left, recipients + summary on the right. */
export function EmailComposer({
  draft,
  options,
  allowedDomains,
  quota,
  signatures,
}: {
  draft: ComposerDraft;
  options: ComposerOptions;
  allowedDomains: string[];
  quota: { used: number; limit: number };
  signatures: SignatureOption[];
}) {
  const t = useTranslations("emailBroadcast");
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [id, setId] = useState<string | null>(draft.id);
  const [fromName, setFromName] = useState(draft.fromName);
  const [fromEmail, setFromEmail] = useState(draft.fromEmail);
  const [replyTo, setReplyTo] = useState(draft.replyTo);
  const [subject, setSubject] = useState(draft.subject);
  const [html, setHtml] = useState(draft.html);
  const [audience, setAudience] = useState(draft.audience);
  const [picked, setPicked] = useState(draft.picked);
  const [attachments, setAttachments] = useState(draft.attachments);
  const [uploading, setUploading] = useState(false);
  const [readingSheet, setReadingSheet] = useState(false);
  // The user's choice; effectiveSignatureId normalizes it against the current
  // list (a signature deleted in another tab drops out after a refresh).
  const [signatureId, setSignatureId] = useState<string | null>(draft.signatureId);
  const chosenSignature = signatures.find((s) => s.id === signatureId) ?? null;
  const effectiveSignatureId = chosenSignature?.id ?? null;
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [busy, startBusy] = useTransition();

  const imageSupport = useEmailImageSupport();
  const noDomains = allowedDomains.length === 0;
  const fromAllowed = isSenderAllowed(fromEmail, allowedDomains);
  const fromProblem = fromEmail.trim() !== "" && !fromAllowed;

  // Live summary, debounced; state only changes inside the timeout.
  useEffect(() => {
    let active = true;
    const handle = setTimeout(async () => {
      try {
        const r = await previewEmailAudience(audience);
        if (active && r.ok) setPreview(r.preview);
      } catch {
        // Network blip or stale action id: keep the previous summary.
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [audience]);

  // Signatures are managed in another tab: refresh the list on return (client
  // state survives router.refresh()).
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  const payload = () => ({
    subject,
    html,
    fromName,
    fromEmail,
    replyTo,
    audience,
    attachments,
    signatureId: effectiveSignatureId,
  });
  const errorText = (r: EmailActionFail) =>
    r.error === "quota"
      ? t("error.quotaDetail", { total: r.total ?? 0, remaining: r.remaining ?? 0 })
      : (r.message ?? t(`error.${r.error}`));

  async function save(): Promise<string | null> {
    const r = await saveEmailDraft(id, payload());
    if (!r.ok) {
      // A deleted signature must leave the select.
      if (r.error === "signature_missing") router.refresh();
      toast(errorText(r), { variant: "error" });
      return null;
    }
    setId(r.id);
    return r.id;
  }

  // A thrown server action (network blip, stale action id after a deploy) must not reach the error
  // boundary: it would discard the unsaved body.
  const guarded = (run: () => Promise<void>) => async () => {
    try {
      await run();
    } catch {
      toast(t("error.unknown"), { variant: "error" });
    }
  };

  function onSaveDraft() {
    startBusy(
      guarded(async () => {
        const savedId = await save();
        if (!savedId) return;
        toast(t("draftSaved"));
        if (!draft.id) router.replace(`/app/email/${savedId}/edit`);
      }),
    );
  }

  function onSend() {
    startBusy(guarded(async () => {
      if (!fromAllowed) {
        toast(t(fromEmail.trim() ? "error.domain_not_allowed" : "error.from_required"), { variant: "error" });
        return;
      }
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
      const minutes = estimateAttachmentSendMinutes(s.total);
      const timing =
        attachments.length === 0
          ? ""
          : ` ${minutes === 0 ? t("confirmAttachmentsQuick") : t("confirmAttachments", { minutes })}`;
      const ok = await confirm({
        title: t("confirmTitle", { count: s.total }),
        description:
          t("confirmBody", {
            subject: subject || t("noSubject"),
            duplicates: s.duplicates,
            suppressed: s.suppressed,
            invalid: s.invalid,
          }) + timing,
        confirmLabel: t("confirmSend", { count: s.total }),
      });
      if (!ok) return;
      const r = await startEmailBroadcast(savedId, effectiveSignatureId);
      if (!r.ok) {
        if (r.error === "signature_missing") router.refresh();
        toast(errorText(r), { variant: "error" });
        return;
      }
      router.push(`/app/email/${savedId}`);
    }));
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold">{t("message")}</h2>
        {noDomains ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="font-medium">{t("domains.noneTitle")}.</span> {t("domains.noneBody")}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fromName">{t("fromName")}</Label>
            <Input id="fromName" value={fromName} maxLength={100} onChange={(e) => setFromName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fromEmail">{t("fromEmail")}</Label>
            <Input
              id="fromEmail"
              type="email"
              value={fromEmail}
              maxLength={254}
              placeholder={t("fromEmailPlaceholder")}
              aria-invalid={fromProblem}
              onChange={(e) => setFromEmail(e.target.value)}
            />
            {fromProblem ? <p className="mt-1 text-xs text-red-600">{t("domains.notAllowed")}</p> : null}
            {!noDomains ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("domains.hint", { domains: allowedDomains.join(", ") })}
              </p>
            ) : null}
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
            images={imageSupport}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {t("footerNotice")} {t("emptyVarHint")}
          </p>
        </div>
        {/* Signature links open in a new tab so the e-mail being written is kept;
            the list refreshes when this window regains focus. */}
        <div className="flex flex-col gap-2">
          {signatures.length === 0 ? (
            <>
              <p className="text-sm font-medium">{t("signature.title")}</p>
              <p className="text-sm text-muted-foreground">
                {t("signature.none")}{" "}
                <Link
                  href="/app/email/signatures/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand hover:underline"
                >
                  {t("signature.create")}
                </Link>
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="signature" className="mb-0">
                  {t("signature.title")}
                </Label>
                <Link
                  href="/app/email/signatures"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-brand hover:underline"
                >
                  {t("signature.manage")}
                </Link>
              </div>
              <select
                id="signature"
                value={effectiveSignatureId ?? ""}
                onChange={(e) => setSignatureId(e.target.value || null)}
                className="w-full max-w-sm rounded-lg border border-border bg-card px-4 py-2.5 text-sm focus-visible:border-brand focus-visible:outline-none"
              >
                {signatures.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.isDefault ? t("signature.defaultOption", { name: s.name }) : s.name}
                  </option>
                ))}
                <option value="">{t("signature.noSignature")}</option>
              </select>
              {chosenSignature ? (
                <SignaturePreview html={chosenSignature.previewHtml} title={t("signature.title")} height={180} />
              ) : (
                <p className="text-xs text-muted-foreground">{t("signature.noneChosen")}</p>
              )}
            </>
          )}
        </div>
        <EmailAttachments value={attachments} onChange={setAttachments} onUploadingChange={setUploading} />
      </section>

      <div className="flex flex-col gap-6">
        <RecipientPicker
          options={options}
          audience={audience}
          onAudienceChange={setAudience}
          picked={picked}
          onPickedChange={setPicked}
          onReadingChange={setReadingSheet}
        />
        <AudienceSummary preview={preview} quota={quota}>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onSaveDraft}
              disabled={busy || uploading || readingSheet}
            >
              {t("saveDraft")}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={onSend}
              disabled={busy || uploading || readingSheet || fromProblem || preview?.stats.total === 0}
            >
              {busy ? t("working") : t("reviewSend")}
            </Button>
          </div>
        </AudienceSummary>
      </div>
    </div>
  );
}
