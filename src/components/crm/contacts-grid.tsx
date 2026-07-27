"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Phone, Mail, Building2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/app/avatar";
import { useUndo } from "@/components/ui/undo";
import { StartChatButton } from "@/components/inbox/start-chat-button";
import { FolderExplorer, type FolderColumn, type ExplorerLabels } from "@/components/crm/folder-explorer";
import { BulkBar } from "@/components/crm/bulk-bar";
import { createFolder, renameFolder, deleteFolder, moveContactToFolder } from "@/app/actions/contact-folders";
import { deleteContact } from "@/app/actions/contacts";
import { bulkDeleteContacts, bulkMoveContacts, bulkTagContacts } from "@/app/actions/bulk";
import type { ContactCard, ContactColumn } from "@/lib/queries/contact-folders";

const GRID_CLS = "grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]";

type ListLabels = { name: string; company: string; phone: string; email: string; select: string };

/** A folder's contacts as summary cards (grid) or a detailed list. */
function ContactList({
  contacts,
  view,
  onDragStart,
  onDragEnd,
  onOpen,
  onDelete,
  deleteLabel,
  labels,
  selected,
  onToggleSelect,
}: {
  contacts: ContactCard[];
  view: "grid" | "list";
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deleteLabel: string;
  labels: ListLabels;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const openCard = (e: React.MouseEvent, id: string) => {
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    onOpen(id);
  };
  const checkbox = (id: string) => (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => onToggleSelect(id)}
      onClick={(e) => e.stopPropagation()}
      aria-label={labels.select}
      className="size-4 shrink-0 cursor-pointer accent-[var(--brand)]"
    />
  );
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
              data-select-id={card.id}
              draggable
              onDragStart={() => onDragStart(card.id)}
              onDragEnd={onDragEnd}
              onClick={(e) => openCard(e, card.id)}
              className={cn(
                "flex cursor-pointer select-none items-center gap-3 border-b border-border px-3 py-2 transition-colors last:border-0 hover:bg-muted/40 active:cursor-grabbing",
                selected.has(card.id) && "bg-brand/5",
              )}
            >
              {checkbox(card.id)}
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

  return (
    <div className={GRID_CLS}>
      {contacts.map((card) => (
        <div
          key={card.id}
          data-select-id={card.id}
          draggable
          onDragStart={() => onDragStart(card.id)}
          onDragEnd={onDragEnd}
          onClick={(e) => openCard(e, card.id)}
          className={cn(
            "hover-lift cursor-pointer select-none rounded-xl border bg-card p-3 shadow-sm active:cursor-grabbing",
            selected.has(card.id) ? "border-brand ring-1 ring-brand" : "border-border",
          )}
        >
          <div className="flex items-start gap-3">
            <div className="pt-0.5">{checkbox(card.id)}</div>
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
  const undo = useUndo();

  // Ids hidden optimistically while an undoable delete is pending. Reconciled
  // against fresh server data: keep only ids still present (i.e. not yet
  // committed), drop the rest.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [prevColumns, setPrevColumns] = useState(columns);
  if (prevColumns !== columns) {
    setPrevColumns(columns);
    const present = new Set(columns.flatMap((c) => c.contacts.map((x) => x.id)));
    setHidden((prev) => new Set([...prev].filter((id) => present.has(id))));
  }

  const cols: FolderColumn<ContactCard>[] = columns.map((c) => ({
    id: c.id,
    name: c.name,
    items: c.contacts.filter((x) => !hidden.has(x.id)),
  }));

  /** Hide now, delete after the undo grace period; restore on undo. */
  function deleteWithUndo(ids: string[], commit: () => Promise<unknown>) {
    setHidden((prev) => new Set([...prev, ...ids]));
    undo({
      message: ids.length === 1 ? tc("deleted") : tc("deletedN", { count: ids.length }),
      commit: async () => {
        await commit();
        router.refresh();
      },
      onUndo: () =>
        setHidden((prev) => {
          const n = new Set(prev);
          ids.forEach((id) => n.delete(id));
          return n;
        }),
    });
  }

  const labels: ExplorerLabels = {
    newFolder: t("newFolder"),
    folderName: t("folderName"),
    addFolder: t("addFolder"),
    cancel: t("cancel"),
    viewGrid: t("viewGrid"),
    viewList: t("viewList"),
    unfiled: t("unfiled"),
    openHint: t("openHint"),
    emptyFolder: t("emptyFolder"),
    renameFolder: t("renameFolder"),
    deleteFolder: t("deleteFolder"),
    confirmDeleteFolder: t("confirmDeleteFolder"),
    save: t("save"),
    dragHint: tc("dragHint"),
    folderCount: (count) => t("folderCount", { count }),
  };
  const listLabels: ListLabels = { name: t("name"), company: t("company"), phone: t("phone"), email: t("email"), select: tc("select") };

  const onDeleteContact = (id: string) => deleteWithUndo([id], () => deleteContact(id));

  return (
    <FolderExplorer<ContactCard>
      storageKey="contacts"
      columns={cols}
      labels={labels}
      onCreateFolder={(name) => createFolder({ name })}
      onRenameFolder={(id, name) => renameFolder(id, { name })}
      onDeleteFolder={(id) => deleteFolder(id)}
      onMoveItem={(id, folderId) => moveContactToFolder(id, folderId)}
      renderItems={({ items, view, onDragStart, onDragEnd, selected, onToggleSelect }) => (
        <ContactList
          contacts={items}
          view={view}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onOpen={(id) => router.push(`/app/contacts/${id}`)}
          onDelete={onDeleteContact}
          deleteLabel={tc("delete")}
          labels={listLabels}
          selected={selected}
          onToggleSelect={onToggleSelect}
        />
      )}
      renderBulkBar={({ ids, folders, clear }) => (
        <BulkBar
          count={ids.length}
          folders={folders}
          onMove={async (folderId) => {
            await bulkMoveContacts(ids, folderId);
            clear();
            router.refresh();
          }}
          onTag={async (tag) => {
            await bulkTagContacts(ids, tag);
            clear();
            router.refresh();
          }}
          onDelete={async () => {
            clear();
            deleteWithUndo(ids, () => bulkDeleteContacts(ids));
          }}
          onClear={clear}
        />
      )}
    />
  );
}
