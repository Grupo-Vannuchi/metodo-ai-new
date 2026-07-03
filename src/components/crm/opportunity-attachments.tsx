"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Paperclip, Trash2, Download, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { deleteOpportunityAttachment } from "@/app/actions/opportunities";

type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  createdAt: string | Date;
};

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Opportunity attachments. Bytes live in object storage — this only lists the
 * metadata and downloads files on demand (never eagerly), so the detail page
 * stays light no matter how many/large the files are.
 */
export function OpportunityAttachments({
  opportunityId,
  attachments,
}: {
  opportunityId: string;
  attachments: Attachment[];
}) {
  const t = useTranslations("crm.attachments");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-selected later
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/opportunities/${opportunityId}/attachments`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) router.refresh();
      else setError(t(`error.${data.error ?? "unknown"}`));
    } catch {
      setError(t("error.unknown"));
    } finally {
      setUploading(false);
    }
  }

  function remove(id: string) {
    start(async () => {
      await deleteOpportunityAttachment(id);
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          {t("add")}
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} />
      </div>

      {error ? <p className="mb-2 text-xs text-red-500">{error}</p> : null}

      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {attachments.map((a) => {
            const Icon = a.mime.startsWith("image/") ? ImageIcon : FileText;
            return (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={a.name}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {a.name}
                </a>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{humanSize(a.size)}</span>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={a.name}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t("download")}
                >
                  <Download className="size-4" />
                </a>
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  disabled={pending}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                  aria-label={t("delete")}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted-foreground">{t("hint")}</p>
    </section>
  );
}
