"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Undo2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";

/**
 * Undoable destructive actions (Gmail-style). Instead of confirming up front,
 * the caller removes the item optimistically and hands us the `commit` (the real
 * server delete). We hold it for a few seconds behind an "Undo" toast:
 *   - timeout elapses  → commit runs;
 *   - user hits Undo    → commit is dropped and `onUndo` restores the UI.
 *
 * A pending commit is flushed (run now) if another action starts or the provider
 * unmounts, so a deferred delete is never silently lost.
 */

type UndoOptions = {
  message: string;
  commit: () => Promise<unknown> | unknown;
  onUndo?: () => void;
  /** Grace period before the commit runs. */
  delayMs?: number;
};

type UndoFn = (options: UndoOptions) => void;

const UndoContext = createContext<UndoFn | null>(null);

export function useUndo(): UndoFn {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error("useUndo must be used within <UndoProvider>");
  return ctx;
}

type UndoDeleteOptions = {
  /** The real server delete, run after the grace period. */
  action: () => Promise<unknown>;
  /** An element inside the row to hide optimistically; the row is its nearest
   *  `[data-undo-row]`, `<tr>` or `<li>` ancestor. Omit to skip the hide. */
  rowFrom?: HTMLElement | null;
  message?: string;
  /** Run after the delete commits (e.g. navigate away). */
  after?: () => void;
  onUndo?: () => void;
};

/**
 * One-call undoable delete for the whole app: hides the row now, defers the
 * server delete behind the "Undo" toast, and restores the row if undone. Any
 * delete button can adopt it — no per-list state needed.
 *
 * The optimistic hide is a plain DOM `display:none` because the surrounding list
 * is usually a Server Component that won't re-render until the commit's
 * `router.refresh()` removes the row for real — so nothing fights the inline
 * style during the grace window.
 */
export function useUndoableDelete() {
  const undo = useUndo();
  const router = useRouter();
  const t = useTranslations("crm.common");
  return useCallback(
    ({ action, rowFrom, message, after, onUndo }: UndoDeleteOptions) => {
      const row = (rowFrom?.closest("[data-undo-row], tr, li") as HTMLElement | null) ?? null;
      const prevDisplay = row?.style.display ?? "";
      if (row) row.style.display = "none";
      undo({
        message: message ?? t("deleted"),
        commit: async () => {
          await action();
          after?.();
          router.refresh();
        },
        onUndo: () => {
          if (row) row.style.display = prevDisplay;
          onUndo?.();
        },
      });
    },
    [undo, router, t],
  );
}

const DEFAULT_DELAY = 6000;

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("undo");
  const [toast, setToast] = useState<{ message: string; delay: number; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommit = useRef<(() => Promise<unknown> | unknown) | null>(null);
  const keyRef = useRef(0);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  // Run the held commit immediately (timeout reached, or flushed early).
  const fire = useCallback(() => {
    clearTimer();
    const commit = pendingCommit.current;
    pendingCommit.current = null;
    setToast(null);
    if (commit) void commit();
  }, []);

  const run = useCallback<UndoFn>(
    ({ message, commit, onUndo, delayMs = DEFAULT_DELAY }) => {
      // Flush a previous pending commit before starting a new one.
      if (pendingCommit.current) fire();
      pendingCommit.current = commit;
      const key = ++keyRef.current;
      setToast({ message, delay: delayMs, key });
      timer.current = setTimeout(() => {
        // Only fire if this is still the active toast.
        if (keyRef.current === key) fire();
      }, delayMs);
      // Stash onUndo alongside the toast via a closure the button will call.
      undoRef.current = () => {
        clearTimer();
        pendingCommit.current = null;
        setToast(null);
        onUndo?.();
      };
    },
    [fire],
  );

  const undoRef = useRef<() => void>(() => {});

  // Flush a pending commit if the whole app unmounts (last resort).
  useEffect(() => () => {
    if (pendingCommit.current) void pendingCommit.current();
  }, []);

  return (
    <UndoContext.Provider value={run}>
      {children}
      {toast ? (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 motion-safe:animate-dialog-in">
          <div className="glass-strong flex items-center gap-3 overflow-hidden rounded-xl border border-border py-2.5 pl-4 pr-2 shadow-2xl">
            <span className="text-sm">{toast.message}</span>
            <button
              type="button"
              onClick={() => undoRef.current()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold text-brand transition-colors hover:bg-brand/10"
            >
              <Undo2 className="size-4" />
              {t("action")}
            </button>
            {/* Countdown bar draining over the grace period. */}
            <span
              key={toast.key}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand/60"
              style={{ animation: `undo-drain ${toast.delay}ms linear forwards` }}
            />
          </div>
        </div>
      ) : null}
    </UndoContext.Provider>
  );
}
