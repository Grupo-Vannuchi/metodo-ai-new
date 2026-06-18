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
import { Input } from "@/components/ui/field";
import { buttonVariants } from "@/components/ui/button";

export type PromptOptions = {
  title?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type PromptFn = (options?: PromptOptions) => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

/** Imperative text prompt: `const name = await prompt({ title, defaultValue })`.
 * Resolves to the trimmed string, or null if cancelled/empty. */
export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error("usePrompt must be used within <PromptProvider>");
  return ctx;
}

/** In-app text prompt dialog, styled with the site theme — replaces the
 * browser's native `window.prompt`. Mounted once near the app root. */
export function PromptProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("dialog");
  const [options, setOptions] = useState<PromptOptions | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback<PromptFn>((opts) => {
    setOptions(opts ?? {});
    setValue(opts?.defaultValue ?? "");
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((result: string | null) => {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }, []);

  useEffect(() => {
    if (!options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") settle(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, settle]);

  function submit() {
    const v = value.trim();
    settle(v ? v : null);
  }

  return (
    <PromptContext.Provider value={prompt}>
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
            onClick={() => settle(null)}
            className="absolute inset-0 cursor-default bg-black/50 motion-safe:animate-overlay-in"
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl motion-safe:animate-dialog-in"
          >
            {options.title ? <h2 className="text-base font-semibold">{options.title}</h2> : null}
            {options.label ? (
              <label className="mt-1 block text-sm text-muted-foreground">{options.label}</label>
            ) : null}
            <Input
              autoFocus
              value={value}
              placeholder={options.placeholder}
              onChange={(e) => setValue(e.target.value)}
              className="mt-3"
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(null)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {options.cancelLabel ?? t("cancel")}
              </button>
              <button type="submit" className={buttonVariants({ variant: "primary", size: "sm" })}>
                {options.confirmLabel ?? t("confirm")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </PromptContext.Provider>
  );
}
