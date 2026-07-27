"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useSessionState } from "@/lib/use-session-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useConfirm } from "@/components/ui/confirm";

/** A folder + its items. `id: null` is the predefined "unfiled" folder. */
export type FolderColumn<T> = { id: string | null; name: string; items: T[] };

export type ExplorerLabels = {
  newFolder: string;
  folderName: string;
  addFolder: string;
  cancel: string;
  viewGrid: string;
  viewList: string;
  unfiled: string;
  openHint: string;
  emptyFolder: string;
  renameFolder: string;
  deleteFolder: string;
  confirmDeleteFolder: string;
  save: string;
  selectAll: string;
  folderCount: (count: number) => string;
};

type RenderItemsArgs<T> = {
  items: T[];
  view: "grid" | "list";
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  /** Multi-select support for the caller's item renderer. */
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
};

/** Context handed to the bulk-action bar shown while a selection is active. */
export type BulkContext = {
  ids: string[];
  /** Folders in this explorer (excluding "unfiled"), for a move-to-folder menu. */
  folders: { id: string; name: string }[];
  clear: () => void;
};

/**
 * Reusable Windows/planner-style folder explorer: folder tiles (icon + name +
 * count, double-click to open, drag an item onto a tile to move it) plus the
 * opened folder's contents below. The entity supplies the item rendering
 * (`renderItems`) and the folder mutations; this owns the shell + drag state.
 * Used by Contacts, Companies, and any future entity with folders.
 *
 * Every folder starts closed; the open one and the grid/list choice are then
 * remembered for the session under `storageKey`, so coming back to the screen
 * lands you where you left off instead of resetting.
 */
export function FolderExplorer<T extends { id: string }>({
  storageKey,
  columns,
  labels,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveItem,
  renderItems,
  renderBulkBar,
}: {
  /** Distinguishes this explorer's session memory (e.g. "contacts"). */
  storageKey: string;
  columns: FolderColumn<T>[];
  labels: ExplorerLabels;
  onCreateFolder: (name: string) => Promise<unknown> | void;
  onRenameFolder: (id: string, name: string) => Promise<unknown> | void;
  onDeleteFolder: (id: string) => Promise<unknown> | void;
  onMoveItem: (itemId: string, folderId: string | null) => Promise<unknown> | void;
  renderItems: (args: RenderItemsArgs<T>) => React.ReactNode;
  /** Optional bulk-action bar, shown while items are selected. */
  renderBulkBar?: (ctx: BulkContext) => React.ReactNode;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [cols, setCols] = useState(columns);
  const [view, setView] = useSessionState<"grid" | "list">(`explorer:${storageKey}:view`, "grid");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overTile, setOverTile] = useState<string | null>(null);
  // `undefined` = no folder open (closed); `null` = the "unfiled" folder is open;
  // a string = that folder is open. Double-click toggles open/closed. Starts
  // closed, then the session's last open folder (if any) is restored on mount.
  const [openId, setOpenId] = useSessionState<string | null | undefined>(
    `explorer:${storageKey}:open`,
    undefined,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Multi-select within the open folder (for bulk actions).
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  // A selection only makes sense within the folder that's open, so switching
  // folders (or closing) clears it — acting on hidden items would surprise.
  const [prevOpen, setPrevOpen] = useState(openId);
  if (prevOpen !== openId) {
    setPrevOpen(openId);
    if (selected.size) setSelected(new Set());
  }

  const keyOf = (id: string | null) => id ?? "__root__";
  const root = cols.find((c) => c.id === null) ?? { id: null, name: "", items: [] as T[] };
  const folders = cols.filter((c) => c.id !== null);
  // When closed (openId === undefined) nothing is shown below the tiles.
  const openCol = openId === undefined ? undefined : cols.find((c) => c.id === openId) ?? undefined;

  const clearSelection = () => setSelected(new Set());
  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const folderItemIds = openCol ? openCol.items.map((i) => i.id) : [];
  const allSelected = folderItemIds.length > 0 && folderItemIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(folderItemIds));
  // Drop ids that vanished after a refresh (deleted/moved out) so the bar count
  // stays honest.
  const selectedIds = folderItemIds.filter((id) => selected.has(id));

  function onDrop(toId: string | null) {
    setOverTile(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;

    let from: string | null | undefined;
    let item: T | undefined;
    for (const c of cols) {
      const found = c.items.find((x) => x.id === id);
      if (found) {
        from = c.id;
        item = found;
        break;
      }
    }
    if (!item || from === toId) return;

    setCols((prevCols) =>
      prevCols.map((c) => {
        if (c.id === from) return { ...c, items: c.items.filter((x) => x.id !== id) };
        if (c.id === toId) return { ...c, items: [item!, ...c.items] };
        return c;
      }),
    );
    start(async () => {
      await onMoveItem(id, toId);
      router.refresh();
    });
  }

  function createFolder() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    setAdding(false);
    start(async () => {
      await onCreateFolder(name);
      router.refresh();
    });
  }

  function rename(id: string) {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name) return;
    start(async () => {
      await onRenameFolder(id, name);
      router.refresh();
    });
  }

  async function del(id: string) {
    if (!(await confirm({ description: labels.confirmDeleteFolder, confirmLabel: labels.deleteFolder, variant: "danger" }))) return;
    if (openId === id) setOpenId(undefined);
    start(async () => {
      await onDeleteFolder(id);
      router.refresh();
    });
  }

  const renderTile = ({ id, name, count, canManage }: { id: string | null; name: string; count: number; canManage: boolean }) => {
    const isOpen = openId === id;
    const isSelected = selectedId === id;
    const isOver = overTile === keyOf(id);
    const Icon = id === null ? (isOpen ? FolderOpen : Inbox) : isOpen ? FolderOpen : Folder;
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
          // Toggle: double-clicking an already-open folder closes it.
          setOpenId((cur) => (cur === id ? undefined : id));
          setSelectedId(id);
        }}
        title={labels.openHint}
        className={cn(
          "group relative flex cursor-pointer select-none flex-col items-center gap-1.5 rounded-xl border p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md",
          isOpen ? "border-brand bg-brand/5 shadow-sm" : isSelected ? "border-brand/50 bg-muted/50" : "border-border bg-card",
          isOver && "border-brand ring-2 ring-brand",
        )}
      >
        {id !== null && renaming === id ? (
          <form
            className="flex w-full items-center gap-1"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              rename(id);
            }}
          >
            <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-8" />
            <button type="submit" className="text-muted-foreground hover:text-foreground" aria-label={labels.save}>
              <Check className="size-4" />
            </button>
            <button type="button" onClick={() => setRenaming(null)} className="text-muted-foreground hover:text-foreground" aria-label={labels.cancel}>
              <X className="size-4" />
            </button>
          </form>
        ) : (
          <>
            <Icon className={cn("size-10 shrink-0", isOpen ? "text-brand" : id === null ? "text-muted-foreground" : "text-brand/80")} />
            <span className="w-full truncate text-sm font-medium">{name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{labels.folderCount(count)}</span>
            {canManage ? (
              <div className="absolute right-1 top-1 flex opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(id);
                    setRenameValue(name);
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={labels.renameFolder}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => del(id!)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                  aria-label={labels.deleteFolder}
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
              createFolder();
            }}
          >
            <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={labels.folderName} className="h-9 w-48" />
            <Button type="submit" size="sm">{labels.addFolder}</Button>
            <button type="button" onClick={() => { setAdding(false); setNewName(""); }} className="text-sm text-muted-foreground hover:text-foreground">
              {labels.cancel}
            </button>
          </form>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <FolderPlus className="size-4" />
            {labels.newFolder}
          </Button>
        )}

        <div className="flex items-center rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => setView("grid")}
            title={labels.viewGrid}
            aria-label={labels.viewGrid}
            aria-pressed={view === "grid"}
            className={cn("rounded-md p-1.5 transition-colors", view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            title={labels.viewList}
            aria-label={labels.viewList}
            aria-pressed={view === "list"}
            className={cn("rounded-md p-1.5 transition-colors", view === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {/* Explorer: folder tiles */}
      <div className="stagger-children grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
        {renderTile({ id: null, name: labels.unfiled, count: root.items.length, canManage: false })}
        {folders.map((col) => renderTile({ id: col.id, name: col.name, count: col.items.length, canManage: true }))}
      </div>

      {/* Content of the opened folder — nothing shown when all are closed. */}
      {openCol ? (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setOverTile(keyOf(openCol.id));
          }}
          onDragLeave={() => setOverTile((c) => (c === keyOf(openCol.id) ? null : c))}
          onDrop={() => onDrop(openCol.id)}
          className={cn("glass rounded-xl border p-4 shadow-sm transition-colors", overTile === keyOf(openCol.id) ? "border-brand" : "border-border")}
        >
          <div className="mb-3 flex items-center gap-2">
            {renderBulkBar && openCol.items.length > 0 ? (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label={labels.selectAll}
                title={labels.selectAll}
                className="size-4 shrink-0 cursor-pointer accent-[var(--brand)]"
              />
            ) : null}
            {openCol.id === null ? <Inbox className="size-4 text-muted-foreground" /> : <FolderOpen className="size-4 text-brand" />}
            <h2 className="text-sm font-semibold">{openCol.id === null ? labels.unfiled : openCol.name}</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{labels.folderCount(openCol.items.length)}</span>
          </div>

          {/* Bulk-action bar — only while a selection is active. */}
          {renderBulkBar && selectedIds.length > 0 ? (
            <div className="mb-3">
              {renderBulkBar({
                ids: selectedIds,
                folders: folders.map((f) => ({ id: f.id as string, name: f.name })),
                clear: clearSelection,
              })}
            </div>
          ) : null}

          {openCol.items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">{labels.emptyFolder}</p>
          ) : (
            renderItems({
              items: openCol.items,
              view,
              onDragStart: setDragId,
              onDragEnd: () => setDragId(null),
              selected,
              onToggleSelect: toggleSelect,
            })
          )}
        </section>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
          {labels.openHint}
        </p>
      )}
    </div>
  );
}
