"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import { RichTextEditor } from "@/components/proposals/rich-text-editor";
import { useEmailImageSupport } from "@/components/email/use-email-image-support";
import { SignaturePreview } from "@/components/email/signature-preview";
import {
  MAX_SIGNATURE_LINE,
  MAX_SIGNATURE_NAME,
  renderSignature,
  signatureContentFromForm,
  signatureImageSrc,
  signatureProblem,
  type SignatureFormFields,
  type SignatureKind,
} from "@/lib/email-broadcast/signature";
import { saveEmailSignature } from "@/app/actions/email-signatures";
import { cn } from "@/lib/utils";

export type SignatureFormInitial = SignatureFormFields & { id: string | null; name: string; isDefault: boolean };

/**
 * Create/edit form of an e-mail signature (spec 2026-10-13 §4.3). The preview
 * uses the same renderSignature as the send and is shown in a sandboxed
 * iframe, because TEXT html here may be unsanitized TipTap output (IMAGE html
 * is fully escaped).
 */
export function SignatureForm({ initial }: { initial: SignatureFormInitial }) {
  const t = useTranslations("emailBroadcast.signatures");
  const ti = useTranslations("emailBroadcast.image");
  const toast = useToast();
  const router = useRouter();
  const images = useEmailImageSupport();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<SignatureKind>(initial.kind);
  const [html, setHtml] = useState(initial.html);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [imageAlt, setImageAlt] = useState(initial.imageAlt);
  const [imageHref, setImageHref] = useState(initial.imageHref);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [uploading, setUploading] = useState(false);
  const [busy, start] = useTransition();

  const fields: SignatureFormFields = { kind, html, imageUrl, imageAlt, imageHref };
  const content = signatureContentFromForm(fields);
  const validImage = signatureImageSrc(imageUrl) !== null;
  const showPreview = kind === "TEXT" ? html.trim() !== "" : validImage;
  const previewHtml = showPreview ? renderSignature(content).html : "";

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await images.upload(file);
      if (url) setImageUrl(url);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onSave() {
    if (!name.trim()) {
      toast(t("errors.invalid"), { variant: "error" });
      return;
    }
    const problem = signatureProblem(content);
    if (problem) {
      toast(t(`errors.${problem}`), { variant: "error" });
      return;
    }
    start(async () => {
      try {
        const r = await saveEmailSignature(initial.id, { name, ...fields, isDefault });
        if (!r.ok) {
          toast(t(`errors.${r.error}`), { variant: "error" });
          return;
        }
        toast(t("form.saved"));
        router.push("/app/email/signatures");
        router.refresh();
      } catch {
        toast(t("errors.unknown"), { variant: "error" });
      }
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
        <div>
          <Label htmlFor="sigName">{t("form.name")}</Label>
          <Input id="sigName" value={name} maxLength={MAX_SIGNATURE_NAME} onChange={(e) => setName(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">{t("form.nameHint")}</p>
        </div>

        <div>
          <p id="sigKind" className="mb-1.5 text-sm font-medium">
            {t("form.kind")}
          </p>
          <div role="group" aria-labelledby="sigKind" className="inline-flex gap-1 rounded-lg bg-muted p-1">
            {(["TEXT", "IMAGE"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  kind === k ? "bg-card text-brand shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "TEXT" ? t("form.kindText") : t("form.kindImage")}
              </button>
            ))}
          </div>
        </div>

        {kind === "TEXT" ? (
          <div>
            {/* Not a <label>: the TipTap editor isn't a form control it could point at. */}
            <p className="mb-1.5 text-sm font-medium">{t("form.content")}</p>
            <RichTextEditor value={html} onChange={setHtml} minHeight="8rem" images={images} />
            <p className="mt-1 text-xs text-muted-foreground">{t("form.contentHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-1.5 text-sm font-medium">{t("form.image")}</p>
              {validImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt={imageAlt}
                  className="mb-2 max-h-40 max-w-full rounded-lg border border-border bg-white object-contain"
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => void onPickImage(e.target.files?.[0])}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  {uploading ? ti("uploading") : imageUrl ? t("form.imageReplace") : t("form.imageUpload")}
                </Button>
                {imageUrl ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl("")}>
                    {t("form.imageRemove")}
                  </Button>
                ) : null}
              </div>
              <Input
                className="mt-2"
                value={imageUrl}
                aria-label={t("form.image")}
                placeholder={t("form.imageLink")}
                onChange={(e) => setImageUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("form.imageHint")}</p>
            </div>
            <div>
              <Label htmlFor="sigHref">
                {t("form.href")} <span className="font-normal text-muted-foreground">{t("form.optional")}</span>
              </Label>
              <Input
                id="sigHref"
                value={imageHref}
                placeholder={t("form.hrefPlaceholder")}
                onChange={(e) => setImageHref(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sigAlt">{t("form.alt")}</Label>
              <Input id="sigAlt" value={imageAlt} maxLength={MAX_SIGNATURE_LINE} onChange={(e) => setImageAlt(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">{t("form.altHint")}</p>
            </div>
          </div>
        )}

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span>
            <span className="font-medium">{t("form.isDefault")}</span>
            <br />
            <span className="text-muted-foreground">{t("form.isDefaultHint")}</span>
          </span>
        </label>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Link href="/app/email/signatures" className={buttonVariants({ variant: "outline" })}>
            {t("form.cancel")}
          </Link>
          <Button type="button" onClick={onSave} disabled={busy || uploading}>
            {busy ? t("form.saving") : t("form.save")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="sigPreview" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6">
        <h2 id="sigPreview" className="text-sm font-semibold">
          {t("form.preview")}
        </h2>
        {previewHtml ? (
          <SignaturePreview html={previewHtml} title={t("form.preview")} height={220} />
        ) : (
          <div className="rounded-lg border border-border bg-white p-5 text-sm text-neutral-900">
            <p className="text-neutral-500">{t("form.previewEmpty")}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("form.previewNote")}</p>
      </section>
    </div>
  );
}
