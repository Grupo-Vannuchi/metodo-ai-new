"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FolderInput, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";

/**
 * Action bar shown by the folder explorer while items are selected. Presentational:
 * the parent grid supplies the async handlers (which run the bulk server action,
 * refresh, and clear the selection). Delete is confirmed here so every caller
 * gets the guard for free. `onTag` is optional — companies don't have tags.
 */
export function BulkBar({
  count,
  folders,
  onMove,
  onTag,
  onDelete,
  onClear,
}: {
  count: number;
  folders: { id: string; name: string }[];
  onMove: (folderId: string | null) => Promise<unknown>;
  onTag?: (tag: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onClear: () => void;
}) {
  const t = useTranslations("crm.bulk");
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [tag, setTag] = useState("");
  const [taggingOpen, setTaggingOpen] = useState(false);

  function move(folderId: string | null) {
    start(async () => {
      await onMove(folderId);
    });
  }

  function addTag() {
    const value = tag.trim();
    if (!value || !onTag) return;
    setTag("");
    setTaggingOpen(false);
    start(async () => {
      await onTag(value);
    });
  }

  async function del() {
    const ok = await confirm({
      description: t("confirmDelete", { count }),
      confirmLabel: t("delete"),
      variant: "danger",
    });
    if (!ok) return;
    start(async () => {
      await onDelete();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2">
      <span className="text-sm font-medium">{t("selected", { count })}</span>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Move to folder. The empty value moves to "unfiled" (null). */}
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <FolderInput className="size-4" />
        <select
          value=""
          disabled={pending}
          onChange={(e) => move(e.target.value || null)}
          className="h-8 max-w-40 rounded-md border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
        >
          <option value="" disabled>
            {t("moveTo")}
          </option>
          <option value="">{t("unfiled")}</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      {onTag ? (
        taggingOpen ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              addTag();
            }}
          >
            <input
              autoFocus
              value={tag}
              disabled={pending}
              onChange={(e) => setTag(e.target.value)}
              onBlur={() => (tag.trim() ? addTag() : setTaggingOpen(false))}
              placeholder={t("tagPlaceholder")}
              className="h-8 w-32 rounded-md border border-border bg-card px-2 text-sm focus-visible:border-brand focus-visible:outline-none"
            />
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {t("addTag")}
            </Button>
          </form>
        ) : (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setTaggingOpen(true)}>
            <Tag className="size-4" />
            {t("tag")}
          </Button>
        )
      ) : null}

      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={del} className="text-red-600 hover:text-red-700">
        <Trash2 className="size-4" />
        {t("delete")}
      </Button>

      <button
        type="button"
        onClick={onClear}
        disabled={pending}
        aria-label={t("clear")}
        title={t("clear")}
        className="ml-auto rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
