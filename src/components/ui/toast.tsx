"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "success" | "error";
type ToastItem = { id: number; message: string; variant: Variant };
type ToastFn = (message: string, opts?: { variant?: Variant }) => void;

const ToastContext = createContext<ToastFn | null>(null);

/** Fire a transient confirmation: `toast("Salvo")` / `toast(msg, { variant: "error" })`. */
export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

type ToastKey =
  | "saved"
  | "done"
  | "moved"
  | "reserved"
  | "released"
  | "consumed"
  | "reversed"
  | "scheduled"
  | "completed"
  | "received"
  | "returned"
  | "canceled"
  | "deleted"
  | "posted"
  | "statusChanged"
  | "error";

/** Toast a localized message by key from the shared `toast` namespace. */
export function useNotify() {
  const toast = useToast();
  const t = useTranslations("toast");
  return useCallback(
    (key: ToastKey, variant?: Variant) => toast(t(key), variant ? { variant } : undefined),
    [toast, t],
  );
}

/**
 * Lightweight toast stack (bottom-center), mounted once near the app root. Any
 * client component calls `useToast()` to confirm an action without a full reload.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastFn>(
    (message, opts) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, message, variant: opts?.variant ?? "success" }]);
      setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((it) => (
          <div
            key={it.id}
            role="status"
            className={cn(
              "glass-strong pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-xl border px-4 py-3 shadow-lg motion-safe:animate-dialog-in",
              it.variant === "error" ? "border-red-500/30" : "border-emerald-500/30",
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full",
                it.variant === "error"
                  ? "bg-red-500/15 text-red-600 dark:text-red-400"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
              )}
            >
              {it.variant === "error" ? <AlertCircle className="size-3.5" /> : <Check className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1 text-sm text-foreground">{it.message}</span>
            <button
              type="button"
              onClick={() => dismiss(it.id)}
              aria-label="Fechar"
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
