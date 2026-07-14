"use client";

import { useRef, useState } from "react";
import { Paperclip, Download, Trash2, FileText, CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/confirm";
import { Spinner } from "@/components/ui/spinner";
import { Input, Label } from "@/components/ui/field";
import { deleteEmployeeDocument } from "@/app/actions/hr";

type Doc = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  expiresAt: Date | string | null;
  createdAt: Date | string;
};

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR");

/** Documents on an employee's record: upload (with an optional expiry date that
 * feeds the dashboard alert), download and delete. */
export function EmployeeDocuments({
  employeeId,
  documents,
}: {
  employeeId: string;
  documents: Doc[];
}) {
  const t = useTranslations("hr");
  const router = useRouter();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (expiresAt) fd.set("expiresAt", expiresAt);
      const r = await fetch(`/api/hr/employees/${employeeId}/documents`, { method: "POST", body: fd });
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (r.ok && data.ok) {
        setExpiresAt("");
        router.refresh();
      } else {
        setError(t(`documents.error.${data.error ?? "unknown"}`));
      }
    } catch {
      setError(t("documents.error.unknown"));
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!(await confirm({ description: t("documents.confirmDelete", { name }), confirmLabel: t("documents.delete"), variant: "danger" }))) return;
    const r = await deleteEmployeeDocument(id);
    if (r.ok) router.refresh();
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-1 text-sm font-semibold">{t("documents.title")}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{t("documents.hint")}</p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Label htmlFor="docExpiry">{t("documents.expiresAt")}</Label>
          <Input
            id="docExpiry"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {uploading ? <Spinner className="size-4" /> : <Paperclip className="size-4" />}
          {t("documents.add")}
        </button>
      </div>

      {error ? <p role="alert" className="mb-3 text-sm text-red-500">{error}</p> : null}

      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {t("documents.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.name}</p>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{fmtSize(doc.size)}</span>
                  <span>·</span>
                  <span>{fmtDate(doc.createdAt)}</span>
                  {doc.expiresAt ? (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1 text-amber-600">
                        <CalendarClock className="size-3" />
                        {t("documents.expiresOn", { date: fmtDate(doc.expiresAt) })}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                download={doc.name}
                title={t("documents.download")}
                aria-label={t("documents.download")}
                className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Download className="size-4" />
              </a>
              <button
                type="button"
                onClick={() => void remove(doc.id, doc.name)}
                title={t("documents.delete")}
                aria-label={t("documents.delete")}
                className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
