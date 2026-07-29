"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { screenContextFromPath } from "@/lib/assistant/context";

type ChatMessage = { role: "user" | "assistant"; text: string };

const NOTICE_BY_ERROR: Record<string, string> = {
  not_configured: "notConfigured",
  forbidden: "forbidden",
  rate_limited: "rateLimited",
  unauthorized: "error",
  invalid: "error",
};

/**
 * The floating AI copilot. Bottom-right on every /app screen; context-aware via
 * the current path. Streams NDJSON from /api/assistant. Read-only in Phase 0.
 */
export function AssistantWidget({ userName }: { userName: string }) {
  const t = useTranslations("assistant");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setInput("");
    setNotice(null);
    setMessages((m) => [...m, { role: "user", text: trimmed }, { role: "assistant", text: "" }]);
    setPending(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, screen: screenContextFromPath(pathname) }),
      });
      if (!res.ok || !res.body) {
        const code = await res.json().then((b) => b?.error).catch(() => "error");
        setMessages((m) => m.slice(0, -1)); // drop the empty assistant bubble
        setNotice(t(`notice.${NOTICE_BY_ERROR[code] ?? "error"}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: { type: string; text?: string };
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.type === "text" && evt.text) {
            setMessages((m) => {
              const next = [...m];
              next[next.length - 1] = {
                role: "assistant",
                text: next[next.length - 1].text + evt.text,
              };
              return next;
            });
          } else if (evt.type === "error") {
            setNotice(t("notice.error"));
          }
        }
      }
    } catch {
      setNotice(t("notice.error"));
      setMessages((m) => (m[m.length - 1]?.text === "" ? m.slice(0, -1) : m));
    } finally {
      setPending(false);
    }
  }

  const suggestions = [
    { key: "pipeline", label: t("suggest.pipeline") },
    { key: "today", label: t("suggest.today") },
    { key: "find", label: t("suggest.find") },
  ];

  return (
    <>
      {/* Panel */}
      {open ? (
        <div className="glass-strong fixed bottom-20 right-4 z-40 flex h-[min(34rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border shadow-2xl">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Sparkles className="size-4" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">{t("title")}</p>
                <p className="text-[11px] text-muted-foreground">{t("readOnlyHint")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("closeLabel")}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("greeting", { name: userName })}</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => send(s.label)}
                      className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                      m.role === "user"
                        ? "bg-brand text-brand-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.text || (pending && i === messages.length - 1 ? "…" : "")}
                  </div>
                </div>
              ))
            )}
            {notice ? <p className="text-xs text-red-600">{notice}</p> : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-border px-3 py-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("placeholder")}
              disabled={pending}
              className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              aria-label={t("send")}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      ) : null}

      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("openLabel")}
        title={t("openLabel")}
        className={cn(
          "fixed bottom-4 right-4 z-40 flex size-12 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-lg transition-transform hover:scale-105 active:scale-95",
          open && "scale-95",
        )}
      >
        {open ? <X className="size-5" /> : <Bot className="size-5" />}
      </button>
    </>
  );
}
