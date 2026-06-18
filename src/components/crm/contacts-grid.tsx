"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Pencil,
  Trash2,
  FolderPlus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Inbox,
} from "lucide-react";
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
import { StartChatButton } from "@/components/inbox/start-chat-button";
import type { ContactCard, ContactColumn } from "@/lib/queries/contact-folders";

export function ContactsGrid({ columns }: { columns: ContactColumn[] }) {
  const t = useTranslations("crm.contacts");
  const tc = useTranslations("crm.common");
  const router = useRouter();
  const [cols, setCols] = useState(columns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set()); // folders are closed by default
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

  const keyOf = (id: string | null) => id ?? "__root__";
  const root = cols.find((c) => c.id === null) ?? { id: null, name: "", contacts: [] };
  const folders = cols.filter((c) => c.id !== null);

  function toggle(id: string) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onDrop(toColumnId: string | null) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;

    let from: string | null | undefined;
    let card: ContactCard | undefined;
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

  function Card({ card }: { card: ContactCard }) {
    return (
      <div
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
          <div className="flex shrink-0 items-center" onPointerDown={(e) => e.stopPropagation()}>
            {card.phone ? (
              <StartChatButton phone={card.phone} name={card.name} contactId={card.id} iconOnly />
            ) : null}
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
    );
  }

  const gridCls =
    "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]";

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

      {/* Root (unfiled) — always open, a drop target back to the top level. */}
      <section
        onDragOver={(e) => { e.preventDefault(); setOverCol(keyOf(null)); }}
        onDragLeave={() => setOverCol((c) => (c === keyOf(null) ? null : c))}
        onDrop={() => onDrop(null)}
        className={cn(
          "rounded-xl border bg-muted/20 p-3",
          overCol === keyOf(null) ? "border-brand" : "border-border",
        )}
      >
        <div className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold">
          <Inbox className="size-4 text-muted-foreground" />
          {t("unfiled")}
          <span className="rounded-full bg-card px-2 py-0.5 text-xs font-normal text-muted-foreground">
            {root.contacts.length}
          </span>
        </div>
        {root.contacts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
            {t("dropHere")}
          </p>
        ) : (
          <div className={gridCls}>
            {root.contacts.map((card) => (
              <Card key={card.id} card={card} />
            ))}
          </div>
        )}
      </section>

      {/* Folders — closed by default, expand to reveal contacts. */}
      <div className="flex flex-col gap-2">
        {folders.map((col) => {
          const id = col.id!;
          const isOpen = open.has(id);
          const isOver = overCol === keyOf(id);
          return (
            <div
              key={id}
              onDragOver={(e) => { e.preventDefault(); setOverCol(keyOf(id)); }}
              onDragLeave={() => setOverCol((c) => (c === keyOf(id) ? null : c))}
              onDrop={() => onDrop(id)}
              className={cn(
                "rounded-xl border bg-card",
                isOver ? "border-brand ring-1 ring-brand" : "border-border",
              )}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                {renaming === id ? (
                  <form
                    className="flex flex-1 items-center gap-1"
                    onSubmit={(e) => { e.preventDefault(); onRename(id); }}
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
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      {isOpen ? (
                        <FolderOpen className="size-4 shrink-0 text-brand" />
                      ) : (
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm font-semibold">{col.name}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                        {col.contacts.length}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { setRenaming(id); setRenameValue(col.name); }}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t("renameFolder")}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteFolder(id)}
                        className="text-muted-foreground transition-colors hover:text-red-600"
                        aria-label={t("deleteFolder")}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>

              {isOpen ? (
                <div className="border-t border-border p-3">
                  {col.contacts.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                      {t("dropHere")}
                    </p>
                  ) : (
                    <div className={gridCls}>
                      {col.contacts.map((card) => (
                        <Card key={card.id} card={card} />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
