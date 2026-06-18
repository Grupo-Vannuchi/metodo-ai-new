"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConfirmOptions = {
  /** Optional bold heading. When omitted, the description is the main text. */
  title?: string;
  /** The question / explanation shown to the user. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" paints the confirm button red (destructive actions). */
  variant?: "default" | "danger";
};

type ConfirmFn = (options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Imperative confirm: `if (await confirm({ description, variant: "danger" }))`. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

/**
 * In-app confirmation dialog, styled with the site theme — replaces the
 * browser's native `window.confirm`. Mounted once near the app root; any client
 * component calls `useConfirm()` and awaits the boolean result.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("dialog");
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts ?? {});
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }, []);

  // Keyboard: Enter confirms, Escape cancels.
  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(false);
      else if (e.key === "Enter") settle(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, settle]);

  const danger = options?.variant === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label={options.cancelLabel ?? t("cancel")}
            onClick={() => settle(false)}
            className="absolute inset-0 cursor-default bg-black/50 motion-safe:animate-overlay-in"
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl motion-safe:animate-dialog-in">
            {options.title ? (
              <h2 className="text-base font-semibold">{options.title}</h2>
            ) : null}
            {options.description ? (
              <p
                className={cn(
                  "text-sm",
                  options.title ? "mt-1 text-muted-foreground" : "text-foreground",
                )}
              >
                {options.description}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {options.cancelLabel ?? t("cancel")}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => settle(true)}
                className={buttonVariants({ variant: danger ? "danger" : "primary", size: "sm" })}
              >
                {options.confirmLabel ?? t("confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
