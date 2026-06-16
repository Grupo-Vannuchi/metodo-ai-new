"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2, FolderPlus, Check, X } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  moveContactToFolder,
} from "@/app/actions/contact-folders";
import { deleteContact } from "@/app/actions/contacts";
import type { ContactColumn } from "@/lib/queries/contact-folders";

export function ContactsGrid({ columns }: { columns: ContactColumn[] }) {
  const t = useTranslations("crm.contacts");
  const tc = useTranslations("crm.common");
  const router = useRouter();
  const [cols, setCols] = useState(columns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [, start] = useTransition();

  // Adopt fresh server data after refresh (derive state from props).
  const [prev, setPrev] = useState(columns);
  if (prev !== columns) {
    setPrev(columns);
    setCols(columns);
  }

  const keyOf = (id: string | null) => id ?? "__unfiled__";

  function onDrop(toColumnId: string | null) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;

    let from: string | null | undefined;
    let card;
    for (const c of cols) {
      const found = c.contacts.find((x) => x.id === id);
      if (found) {
        from = c.id;
        card = found;
        break;
      }
    }
    if (!card || from === toColumnId) return;

    setCols((prevCols) =>
      prevCols.map((c) => {
        if (c.id === from) return { ...c, contacts: c.contacts.filter((x) => x.id !== id) };
        if (c.id === toColumnId) return { ...c, contacts: [card!, ...c.contacts] };
        return c;
      }),
    );

    start(async () => {
      await moveContactToFolder(id, toColumnId);
      router.refresh();
    });
  }

  function onCreateFolder() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    setAdding(false);
    start(async () => {
      await createFolder({ name });
      router.refresh();
    });
  }

  function onRename(id: string) {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name) return;
    start(async () => {
      await renameFolder(id, { name });
      router.refresh();
    });
  }

  function onDeleteFolder(id: string) {
    if (!window.confirm(t("confirmDeleteFolder"))) return;
    start(async () => {
      await deleteFolder(id);
      router.refresh();
    });
  }

  function onDeleteContact(id: string) {
    if (!window.confirm(tc("confirmDelete"))) return;
    setCols((prevCols) =>
      prevCols.map((c) => ({ ...c, contacts: c.contacts.filter((x) => x.id !== id) })),
    );
    start(async () => {
      await deleteContact(id);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {adding ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onCreateFolder();
            }}
          >
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("folderName")}
              className="h-9 w-48"
            />
            <Button type="submit" size="sm">{t("addFolder")}</Button>
            <button
              type="button"
              onClick={() => { setAdding(false); setNewName(""); }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {t("cancel")}
            </button>
          </form>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <FolderPlus className="size-4" />
            {t("newFolder")}
          </Button>
        )}
      </div>

      <div className="grid gap-4 pb-4 [grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))]">
        {cols.map((col) => (
          <div
            key={keyOf(col.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(keyOf(col.id));
            }}
            onDragLeave={() => setOverCol((c) => (c === keyOf(col.id) ? null : c))}
            onDrop={() => onDrop(col.id)}
            className={cn(
              "flex min-w-0 flex-col rounded-xl border bg-muted/30 p-3",
              overCol === keyOf(col.id) ? "border-brand" : "border-border",
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              {renaming === col.id && col.id ? (
                <form
                  className="flex flex-1 items-center gap-1"
                  onSubmit={(e) => { e.preventDefault(); onRename(col.id!); }}
                >
                  <Input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-8"
                  />
                  <button type="submit" className="text-muted-foreground hover:text-foreground" aria-label={t("save")}>
                    <Check className="size-4" />
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} className="text-muted-foreground hover:text-foreground" aria-label={t("cancel")}>
                    <X className="size-4" />
                  </button>
                </form>
              ) : (
                <>
                  <span className="truncate text-sm font-semibold">
                    {col.id === null ? t("unfiled") : col.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
                      {col.contacts.length}
                    </span>
                    {col.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => { setRenaming(col.id); setRenameValue(col.name); }}
                          className="text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={t("renameFolder")}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteFolder(col.id!)}
                          className="text-muted-foreground transition-colors hover:text-red-600"
                          aria-label={t("deleteFolder")}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-2">
              {col.contacts.map((card) => (
                <div
                  key={card.id}
                  draggable
                  onDragStart={() => setDragId(card.id)}
                  onDragEnd={() => setDragId(null)}
                  className="cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{card.name}</p>
                      {card.companyName ? (
                        <p className="truncate text-xs text-muted-foreground">{card.companyName}</p>
                      ) : null}
                    </div>
                    <div
                      className="flex shrink-0 items-center"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <Link
                        href={`/app/contacts/${card.id}`}
                        className="rounded-lg px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={tc("edit")}
                      >
                        <Pencil className="size-3.5" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDeleteContact(card.id)}
                        className="rounded-lg px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
                        aria-label={tc("delete")}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  {card.phone || card.email ? (
                    <p className="mt-2 truncate text-xs text-muted-foreground">
                      {card.phone ?? card.email}
                    </p>
                  ) : null}
                </div>
              ))}
              {col.contacts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  {t("dropHere")}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
