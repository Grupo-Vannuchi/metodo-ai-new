"use client";

import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_BYTES,
  attachmentAddProblem,
  attachmentSizeParts,
  type EmailAttachment,
} from "@/lib/email-broadcast/attachments";

const PROBLEM_KEY = { count: "errorCount", type: "errorType", total: "errorTotal" } as const;

/**
 * "Anexos" section of the composer (spec 2026-10-09 §6). Files are checked
 * with the server's rules, then uploaded one request at a time, in order.
 * While uploading, the parent disables save/send and removal is blocked, so
 * the list built here can't race an edit.
 */
export function EmailAttachments({
  value,
  onChange,
  onUploadingChange,
}: {
  value: EmailAttachment[];
  onChange: (next: EmailAttachment[]) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const t = useTranslations("emailBroadcast.attachments");
  const format = useFormatter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const size = (bytes: number) => {
    const { value: n, unit } = attachmentSizeParts(bytes);
    return `${format.number(n, { maximumFractionDigits: 1 })} ${unit}`;
  };

  async function upload(file: File): Promise<EmailAttachment | null> {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/email/attachment", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        attachment?: EmailAttachment;
        error?: string;
      };
      if (res.ok && data.ok && data.attachment) return data.attachment;
      const key = data.error === "type" ? "errorType" : data.error === "size" ? "errorTotal" : "errorUpload";
      toast(t(key, { file: file.name }), { variant: "error" });
    } catch (error) {
      console.error("[email-attachment] upload failed", error);
      toast(t("errorUpload", { file: file.name }), { variant: "error" });
    }
    return null;
  }

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    if (input.current) input.current.value = "";
    let list = value;
    onUploadingChange(true);
    try {
      for (const file of picked) {
        const problem = attachmentAddProblem(list, file);
        if (problem) {
          toast(t(PROBLEM_KEY[problem], { file: file.name, max: MAX_ATTACHMENTS }), { variant: "error" });
          continue;
        }
        setUploading(file.name);
        const added = await upload(file);
        if (added) {
          list = [...list, added];
          onChange(list);
        }
      }
    } finally {
      setUploading(null);
      onUploadingChange(false);
    }
  }

  const used = value.reduce((n, a) => n + a.size, 0);

  return (
    <div>
      {/* Not a <label>: the hidden file input is driven by the button below. */}
      <p className="mb-1.5 text-sm font-medium">{t("title")}</p>
      {value.length > 0 ? (
        <ul className="mb-2 flex flex-col divide-y divide-border rounded-lg border border-border">
          {value.map((a) => (
            <li key={a.key} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.filename}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{size(a.size)}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.key !== a.key))}
                disabled={uploading !== null}
                aria-label={t("remove", { file: a.filename })}
                className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {uploading ? <p className="mb-2 text-xs text-muted-foreground">{t("uploading", { file: uploading })}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(e) => void onPick(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={uploading !== null || value.length >= MAX_ATTACHMENTS}
        >
          {t("add")}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t("counter", { count: value.length, used: size(used), max: size(MAX_ATTACHMENTS_BYTES) })}
        </span>
      </div>
      {value.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("notice")}</p> : null}
    </div>
  );
}
