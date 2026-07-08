"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";

/** Upload one image to the template-image endpoint; returns its URL or null. */
export async function uploadTemplateImage(file: File): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/proposals/template-image", { method: "POST", body: fd });
    const data = (await r.json().catch(() => ({}))) as { ok?: boolean; url?: string };
    return r.ok && data.ok && data.url ? data.url : null;
  } catch {
    return null;
  }
}

/** A single-image slot: thumbnail preview + upload + remove. */
export function TemplateImageField({
  label,
  url,
  onChange,
}: {
  label: string;
  url: string;
  onChange: (url: string) => void;
}) {
  const t = useTranslations("proposalTemplates");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File) {
    setBusy(true);
    const uploaded = await uploadTemplateImage(file);
    setBusy(false);
    if (uploaded) onChange(uploaded);
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
      {url ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className="h-12 w-auto max-w-32 rounded object-contain" />
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {busy ? <Spinner className="size-3.5" /> : t("form.replaceImage")}
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label={t("form.removeImage")}
              title={t("form.removeImage")}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Spinner className="size-4" /> : <ImagePlus className="size-4" />}
          {t("form.uploadImage")}
        </button>
      )}
    </div>
  );
}
