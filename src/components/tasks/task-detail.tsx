"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ListChecks,
  Paperclip,
  Plus,
  Trash2,
  Check,
  Upload,
  FileText,
  Circle,
  CircleDot,
  CheckCircle2,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";
import {
  setTaskStatus,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
  deleteTaskAttachment,
} from "@/app/actions/tasks";

type Status = "TODO" | "IN_PROGRESS" | "DONE";
type ChecklistItem = { id: string; text: string; done: boolean };
type Attachment = { id: string; name: string; mime: string; size: number; url: string };

const STATUS_META: { key: Status; icon: typeof Circle; active: string }[] = [
  { key: "TODO", icon: Circle, active: "border-brand bg-brand/10 text-brand" },
  { key: "IN_PROGRESS", icon: CircleDot, active: "border-amber-500 bg-amber-500/10 text-amber-600" },
  { key: "DONE", icon: CheckCircle2, active: "border-green-500 bg-green-500/10 text-green-600" },
];

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Interactive parts of the task view: status control + progress, checklist and
 * attachments. Static fields stay on the (server) page. */
export function TaskDetail({
  taskId,
  status,
  progress,
  checklist: initialChecklist,
  attachments: initialAttachments,
}: {
  taskId: string;
  status: Status;
  progress: number;
  checklist: ChecklistItem[];
  attachments: Attachment[];
}) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  const [checklist, setChecklist] = useState(initialChecklist);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [newItem, setNewItem] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doneCount = checklist.filter((c) => c.done).length;
  const shownProgress = checklist.length > 0 ? Math.round((doneCount / checklist.length) * 100) : progress;

  function changeStatus(next: Status) {
    if (next === status) return;
    start(async () => {
      await setTaskStatus(taskId, next);
      router.refresh();
    });
  }

  function addItem() {
    const text = newItem.trim();
    if (!text) return;
    setNewItem("");
    start(async () => {
      const r = await addChecklistItem(taskId, text);
      if (r.ok && r.id) setChecklist((prev) => [...prev, { id: r.id!, text, done: false }]);
      router.refresh();
    });
  }

  function toggleItem(item: ChecklistItem) {
    setChecklist((prev) => prev.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)));
    start(async () => {
      await toggleChecklistItem(item.id, !item.done);
      router.refresh();
    });
  }

  function removeItem(item: ChecklistItem) {
    setChecklist((prev) => prev.filter((c) => c.id !== item.id));
    start(async () => {
      await deleteChecklistItem(item.id);
      router.refresh();
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; attachment?: Attachment; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.attachment) {
        const code = data?.error === "size" || data?.error === "type" || data?.error === "count" ? data.error : "unknown";
        setUploadError(t(`attachments.error.${code}`));
        return;
      }
      setAttachments((prev) => [data.attachment!, ...prev]);
      router.refresh();
    } catch {
      setUploadError(t("attachments.error.unknown"));
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(att: Attachment) {
    if (!(await confirm({ description: t("attachments.removeConfirm"), confirmLabel: t("attachments.remove"), variant: "danger" }))) return;
    setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    start(async () => {
      await deleteTaskAttachment(att.id);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Status + progress */}
      <div className="glass rounded-xl border border-border p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {STATUS_META.map(({ key, icon: Icon, active }) => (
            <button
              key={key}
              type="button"
              onClick={() => changeStatus(key)}
              disabled={pending}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60",
                status === key ? active : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-4" />
              {t(`status.${key}`)}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("field.progress")}</span>
            <span className="tabular-nums">{shownProgress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", shownProgress >= 100 ? "bg-green-500" : "bg-brand")}
              style={{ width: `${shownProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="glass rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-brand" />
          <h2 className="text-sm font-semibold">{t("checklist.title")}</h2>
          {checklist.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {t("checklist.count", { done: doneCount, total: checklist.length })}
            </span>
          ) : null}
        </div>

        {checklist.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {checklist.map((item) => (
              <li key={item.id} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                <button
                  type="button"
                  onClick={() => toggleItem(item)}
                  disabled={pending}
                  aria-label={item.done ? t("reopen") : t("complete")}
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                    item.done ? "border-green-500 bg-green-500 text-white" : "border-border hover:border-brand",
                  )}
                >
                  {item.done ? <Check className="size-3.5" /> : null}
                </button>
                <span className={cn("min-w-0 flex-1 break-words text-sm", item.done && "text-muted-foreground line-through")}>
                  {item.text}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  disabled={pending}
                  aria-label={t("delete")}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("checklist.empty")}</p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder={t("checklist.placeholder")}
            maxLength={300}
          />
          <button
            type="button"
            onClick={addItem}
            disabled={pending || !newItem.trim()}
            aria-label={t("checklist.add")}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      {/* Attachments */}
      <div className="glass rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Paperclip className="size-4 text-brand" />
            <h2 className="text-sm font-semibold">{t("attachments.title")}</h2>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <Upload className="size-4" />
            {uploading ? t("attachments.uploading") : t("attachments.add")}
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
        </div>

        {uploadError ? <p className="mt-2 text-sm text-red-500">{uploadError}</p> : null}

        {attachments.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {attachments.map((att) => (
              <li key={att.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 p-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <FileText className="size-4" />
                </span>
                <a href={att.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium hover:underline">{att.name}</span>
                  <span className="block text-xs text-muted-foreground">{fmtBytes(att.size)}</span>
                </a>
                <button
                  type="button"
                  onClick={() => removeAttachment(att)}
                  disabled={pending}
                  aria-label={t("attachments.remove")}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("attachments.empty")}</p>
        )}
      </div>
    </div>
  );
}
