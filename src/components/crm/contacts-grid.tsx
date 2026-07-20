"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Pencil,
  Trash2,
  FolderPlus,
  Folder,
  FolderOpen,
  Check,
  X,
  Inbox,
  LayoutGrid,
  List,
  Phone,
  Mail,
  Building2,
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Avatar } from "@/components/app/avatar";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  moveContactToFolder,
} from "@/app/actions/contact-folders";
import { deleteContact } from "@/app/actions/contacts";
import { useConfirm } from "@/components/ui/confirm";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import type { ContactCard, ContactColumn } from "@/lib/queries/contact-folders";

const GRID_CLS = "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]";

type ContactItemProps = {
  contacts: ContactCard[];
  view: "grid" | "list";
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deleteLabel: string;
  labels: { name: string; company: string; phone: string; email: string };
};

/** A folder's contacts as summary cards (grid) or a detailed list. */
function ContactList({ contacts, view, onDragStart, onDragEnd, onOpen, onDelete, deleteLabel, labels }: ContactItemProps) {
  const openCard = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    onOpen(id);
  };
  const actions = (card: ContactCard) => (
    <div className="flex shrink-0 items-center" onPointerDown={(e) => e.stopPropagation()}>
      {card.phone ? <StartChatButton phone={card.phone} name={card.name} contactId={card.id} iconOnly /> : null}
      <button
        type="button"
        onClick={() => onDelete(card.id)}
        className="rounded-lg px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-red-600"
        aria-label={deleteLabel}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );

  if (view === "list") {
    // Detailed list: header row + columns (name, company, phone, e-mail).
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="hidden items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground sm:flex">
          <span className="flex-1">{labels.name}</span>
          <span className="w-40 shrink-0">{labels.company}</span>
          <span className="w-36 shrink-0">{labels.phone}</span>
          <span className="w-52 shrink-0">{labels.email}</span>
          <span className="w-16 shrink-0" />
        </div>
        <div className="flex flex-col">
          {contacts.map((card) => (
            <div
              key={card.id}
              draggable
              onDragStart={() => onDragStart(card.id)}
              onDragEnd={onDragEnd}
              onClick={(e) => openCard(e, card.id)}
              className="flex cursor-pointer select-none items-center gap-3 border-b border-border px-3 py-2 transition-colors last:border-0 hover:bg-muted/40 active:cursor-grabbing"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <Avatar name={card.name} className="size-8 shrink-0 text-xs" />
                <span className="truncate text-sm font-medium">{card.name}</span>
              </div>
              <span className="hidden w-40 shrink-0 truncate text-xs text-muted-foreground sm:block">{card.companyName ?? "—"}</span>
              <span className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground sm:block">{card.phone ?? "—"}</span>
              <span className="hidden w-52 shrink-0 truncate text-xs text-muted-foreground sm:block">{card.email ?? "—"}</span>
              <div className="w-16 shrink-0">{actions(card)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Grid: richer summary cards (avatar + name + company + phone + e-mail).
  return (
    <div className={GRID_CLS}>
      {contacts.map((card) => (
        <div
          key={card.id}
          draggable
          onDragStart={() => onDragStart(card.id)}
          onDragEnd={onDragEnd}
          onClick={(e) => openCard(e, card.id)}
          className="hover-lift cursor-pointer select-none rounded-xl border border-border bg-card p-3 shadow-sm active:cursor-grabbing"
        >
          <div className="flex items-start gap-3">
            <Avatar name={card.name} className="size-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{card.name}</p>
              {card.companyName ? (
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <Building2 className="size-3 shrink-0" />
                  <span className="truncate">{card.companyName}</span>
                </p>
              ) : null}
            </div>
            {actions(card)}
          </div>
          {card.phone || card.email ? (
            <div className="mt-2.5 flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
              {card.phone ? (
                <span className="flex items-center gap-1.5">
                  <Phone className="size-3 shrink-0" />
                  <span className="truncate">{card.phone}</span>
                </span>
              ) : null}
              {card.email ? (
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{card.email}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ContactsGrid({ columns }: { columns: ContactColumn[] }) {
  const t = useTranslations("crm.contacts");
  const tc = useTranslations("crm.common");
  const router = useRouter();
  const confirm = useConfirm();
  const [cols, setCols] = useState(columns);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overTile, setOverTile] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null); // opened folder (null = "unfiled")
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const openCol = cols.find((c) => c.id === openId) ?? root;

  function onDrop(toColumnId: string | null) {
    setOverTile(null);
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

  async function onDeleteFolder(id: string) {
    if (!(await confirm({ description: t("confirmDeleteFolder"), confirmLabel: t("deleteFolder"), variant: "danger" }))) return;
    if (openId === id) setOpenId(null);
    start(async () => {
      await deleteFolder(id);
      router.refresh();
    });
  }

  async function onDeleteContact(id: string) {
    if (!(await confirm({ description: tc("confirmDelete"), confirmLabel: tc("delete"), variant: "danger" }))) return;
    setCols((prevCols) => prevCols.map((c) => ({ ...c, contacts: c.contacts.filter((x) => x.id !== id) })));
    start(async () => {
      await deleteContact(id);
      router.refresh();
    });
  }

  const labels = { name: t("name"), company: t("company"), phone: t("phone"), email: t("email") };

  /** One explorer folder tile: icon + name + count. Double-click opens it;
   * a dragged contact dropped on it is moved into the folder. A plain render
   * helper (not a nested component) so it can close over the folder state. */
  const renderTile = ({
    id,
    name,
    count,
    icon: Icon,
    canManage,
  }: {
    id: string | null;
    name: string;
    count: number;
    icon: typeof Folder;
    canManage: boolean;
  }) => {
    const isOpen = openId === id;
    const isSelected = selectedId === id;
    const isOver = overTile === keyOf(id);
    return (
      <div
        key={keyOf(id)}
        onDragOver={(e) => {
          e.preventDefault();
          setOverTile(keyOf(id));
        }}
        onDragLeave={() => setOverTile((c) => (c === keyOf(id) ? null : c))}
        onDrop={() => onDrop(id)}
        onClick={() => setSelectedId(id)}
        onDoubleClick={() => {
          setOpenId(id);
          setSelectedId(id);
        }}
        title={t("openHint")}
        className={cn(
          "group relative flex cursor-pointer select-none flex-col items-center gap-1.5 rounded-xl border p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md",
          isOpen
            ? "border-brand bg-brand/5 shadow-sm"
            : isSelected
              ? "border-brand/50 bg-muted/50"
              : "border-border bg-card",
          isOver && "border-brand ring-2 ring-brand",
        )}
      >
        {renaming === id ? (
          <form
            className="flex w-full items-center gap-1"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              onRename(id!);
            }}
          >
            <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8" />
            <button type="submit" className="text-muted-foreground hover:text-foreground" aria-label={t("save")}>
              <Check className="size-4" />
            </button>
            <button type="button" onClick={() => setRenaming(null)} className="text-muted-foreground hover:text-foreground" aria-label={t("cancel")}>
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <Icon className={cn("size-10 shrink-0", isOpen ? "text-brand" : id === null ? "text-muted-foreground" : "text-brand/80")} />
            <span className="w-full truncate text-sm font-medium">{name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("folderCount", { count })}</span>
            {canManage ? (
              <div
                className="absolute right-1 top-1 flex opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(id);
                    setRenameValue(name);
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t("renameFolder")}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteFolder(id!)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                  aria-label={t("deleteFolder")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: new folder + view toggle */}
      <div className="flex items-center justify-between gap-2">
        {adding ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onCreateFolder();
            }}
          >
            <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("folderName")} className="h-9 w-48" />
            <Button type="submit" size="sm">{t("addFolder")}</Button>
            <button type="button" onClick={() => { setAdding(false); setNewName(""); }} className="text-sm text-muted-foreground hover:text-foreground">
              {t("cancel")}
            </button>
          </form>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <FolderPlus className="size-4" />
            {t("newFolder")}
          </Button>
        )}

        <div className="flex items-center rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => setView("grid")}
            title={t("viewGrid")}
            aria-label={t("viewGrid")}
            aria-pressed={view === "grid"}
            className={cn("rounded-md p-1.5 transition-colors", view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            title={t("viewList")}
            aria-label={t("viewList")}
            aria-pressed={view === "list"}
            className={cn("rounded-md p-1.5 transition-colors", view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {/* Explorer: folder tiles (double-click to open; drop a contact to move) */}
      <div className="stagger-children grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
        {renderTile({ id: null, name: t("unfiled"), count: root.contacts.length, icon: openId === null ? FolderOpen : Inbox, canManage: false })}
        {folders.map((col) =>
          renderTile({ id: col.id, name: col.name, count: col.contacts.length, icon: openId === col.id ? FolderOpen : Folder, canManage: true }),
        )}
      </div>

      {/* Content of the opened folder */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setOverTile(keyOf(openCol.id));
        }}
        onDragLeave={() => setOverTile((c) => (c === keyOf(openCol.id) ? null : c))}
        onDrop={() => onDrop(openCol.id)}
        className={cn(
          "glass rounded-xl border p-4 shadow-sm transition-colors",
          overTile === keyOf(openCol.id) ? "border-brand" : "border-border",
        )}
      >
        <div className="mb-3 flex items-center gap-2">
          {openCol.id === null ? (
            <Inbox className="size-4 text-muted-foreground" />
          ) : (
            <FolderOpen className="size-4 text-brand" />
          )}
          <h2 className="text-sm font-semibold">{openCol.id === null ? t("unfiled") : openCol.name}</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t("folderCount", { count: openCol.contacts.length })}
          </span>
        </div>
        {openCol.contacts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
            {t("emptyFolder")}
          </p>
        ) : (
          <ContactList
            contacts={openCol.contacts}
            view={view}
            onDragStart={setDragId}
            onDragEnd={() => setDragId(null)}
            onOpen={(id) => router.push(`/app/contacts/${id}`)}
            onDelete={onDeleteContact}
            deleteLabel={tc("delete")}
            labels={labels}
          />
        )}
      </section>
    </div>
  );
}
