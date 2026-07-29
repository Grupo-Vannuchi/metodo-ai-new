"use client";

import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Bot, Check, Copy, History, Plus, Send, Sparkles, SquarePen, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { screenContextFromPath } from "@/lib/assistant/context";
import { getActiveForm, subscribeForm } from "@/components/app/assistant/form-store";
import {
  deleteAssistantThread,
  listAssistantThreads,
  loadAssistantThread,
  type ThreadSummary,
} from "@/app/actions/assistant";

type ChatMessage = { role: "user" | "assistant"; text: string };
type PendingConfirm = { id: string; tool: string; summary: string; args: Record<string, unknown> };
type PlanStep = { tool: string; summary: string; args: Record<string, unknown> };
type PendingPlan = { id: string; title: string; steps: PlanStep[] };

/**
 * Minimal, safe inline formatting for the copilot's replies: **bold**, *italic*
 * / _italic_, and `code`. Renders into React text nodes (auto-escaped) — no
 * dangerouslySetInnerHTML. Newlines are handled by `whitespace-pre-wrap`.
 */
function renderRich(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("*")) nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("_")) nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    else
      nodes.push(
        <code key={key++} className="rounded bg-black/10 px-1 text-[0.85em] dark:bg-white/15">
          {tok.slice(1, -1)}
        </code>,
      );
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const NOTICE_BY_ERROR: Record<string, string> = {
  not_configured: "notConfigured",
  forbidden: "forbidden",
  rate_limited: "rateLimited",
  daily_limit: "dailyLimit",
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [confirms, setConfirms] = useState<PendingConfirm[]>([]);
  const [plans, setPlans] = useState<PendingPlan[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [showChats, setShowChats] = useState(false);
  const activeForm = useSyncExternalStore(subscribeForm, getActiveForm, () => null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function refreshThreads() {
    try {
      setThreads(await listAssistantThreads());
    } catch {
      /* ignore */
    }
  }

  function newChat() {
    setThreadId(null);
    setMessages([]);
    setConfirms([]);
    setPlans([]);
    setNotice(null);
    setShowChats(false);
  }

  async function openChat(id: string) {
    setShowChats(false);
    setConfirms([]);
    setPlans([]);
    setNotice(null);
    try {
      const msgs = await loadAssistantThread(id);
      setMessages(msgs.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", text: m.content })));
      setThreadId(id);
    } catch {
      setNotice(t("notice.error"));
    }
  }

  async function removeChat(id: string, e: ReactMouseEvent) {
    e.stopPropagation();
    await deleteAssistantThread(id).catch(() => {});
    if (id === threadId) newChat();
    void refreshThreads();
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) void refreshThreads();
  }

  async function runConfirm(c: PendingConfirm) {
    setConfirms((p) => p.filter((x) => x.id !== c.id));
    try {
      const res = await fetch("/api/assistant/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: c.tool, args: c.args }),
      });
      const data = await res.json().catch(() => null);
      const msg = (data && data.message) || (res.ok ? "Feito." : t("notice.error"));
      setMessages((m) => [...m, { role: "assistant", text: msg }]);
      if (res.ok && data?.ok) router.refresh();
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: t("notice.error") }]);
    }
  }

  function cancelConfirm(c: PendingConfirm) {
    setConfirms((p) => p.filter((x) => x.id !== c.id));
    setMessages((m) => [...m, { role: "assistant", text: t("cancelled") }]);
  }

  async function runPlan(pl: PendingPlan) {
    setPlans((p) => p.filter((x) => x.id !== pl.id));
    try {
      const res = await fetch("/api/assistant/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: pl.steps.map((s) => ({ tool: s.tool, args: s.args })) }),
      });
      const data = await res.json().catch(() => null);
      const msg = (data && data.message) || (res.ok ? "Feito." : t("notice.error"));
      setMessages((m) => [...m, { role: "assistant", text: msg }]);
      if (res.ok && data?.ok) router.refresh();
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: t("notice.error") }]);
    }
  }

  function cancelPlan(pl: PendingPlan) {
    setPlans((p) => p.filter((x) => x.id !== pl.id));
    setMessages((m) => [...m, { role: "assistant", text: t("cancelled") }]);
  }

  async function copy(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending, confirms, plans]);

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
        body: JSON.stringify({
          message: trimmed,
          threadId,
          screen: screenContextFromPath(pathname),
          form: activeForm
            ? { key: activeForm.key, title: activeForm.title, fields: activeForm.fields }
            : undefined,
        }),
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
          let evt: {
            type: string;
            text?: string;
            formKey?: string;
            values?: Record<string, string>;
            id?: string;
            tool?: string;
            summary?: string;
            args?: Record<string, unknown>;
            title?: string;
            steps?: PlanStep[];
          };
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
          } else if (evt.type === "prefill" && evt.values) {
            // Apply the copilot's proposed values into the open form for review.
            const f = getActiveForm();
            if (f && f.key === evt.formKey) f.apply(evt.values);
          } else if (evt.type === "confirm" && evt.id && evt.tool) {
            const card: PendingConfirm = {
              id: evt.id,
              tool: evt.tool,
              summary: evt.summary ?? "",
              args: evt.args ?? {},
            };
            setConfirms((p) => [...p, card]);
          } else if (evt.type === "plan" && evt.id && Array.isArray(evt.steps)) {
            const plan: PendingPlan = { id: evt.id, title: evt.title ?? "", steps: evt.steps };
            if (plan.steps.length > 0) setPlans((p) => [...p, plan]);
          } else if (evt.type === "thread" && evt.id) {
            setThreadId(evt.id);
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
      void refreshThreads();
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
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={newChat}
                aria-label={t("newChat")}
                title={t("newChat")}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <SquarePen className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !showChats;
                  setShowChats(next);
                  if (next) void refreshThreads();
                }}
                aria-label={t("chats")}
                title={t("chats")}
                className={cn(
                  "rounded-lg p-1.5 transition-colors hover:bg-muted hover:text-foreground",
                  showChats ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                <History className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("closeLabel")}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          {showChats ? (
            <div className="absolute inset-x-0 top-[3.25rem] z-10 max-h-72 overflow-y-auto border-b border-border bg-card p-2 shadow-lg">
              <button
                type="button"
                onClick={newChat}
                className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-muted"
              >
                <Plus className="size-4" />
                {t("newChat")}
              </button>
              {threads.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("noChats")}</p>
              ) : (
                threads.map((th) => (
                  <div
                    key={th.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                      th.id === threadId ? "bg-brand/10" : "hover:bg-muted",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openChat(th.id)}
                      className="min-w-0 flex-1 truncate text-left"
                    >
                      {th.title || t("untitled")}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => removeChat(th.id, e)}
                      aria-label={t("deleteChat")}
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : null}

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
                <div key={i} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                      m.role === "user"
                        ? "bg-brand text-brand-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.text
                      ? m.role === "assistant"
                        ? renderRich(m.text)
                        : m.text
                      : pending && i === messages.length - 1
                        ? "…"
                        : ""}
                  </div>
                  {m.role === "assistant" && m.text ? (
                    <button
                      type="button"
                      onClick={() => copy(m.text, i)}
                      className="mt-1 flex items-center gap-1 px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {copiedIdx === i ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {copiedIdx === i ? t("copied") : t("copy")}
                    </button>
                  ) : null}
                </div>
              ))
            )}
            {confirms.map((c) => (
              <div key={c.id} className="rounded-xl border border-brand/40 bg-brand/5 p-3">
                <p className="text-xs font-semibold text-foreground">{t("confirmTitle")}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{c.summary}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => runConfirm(c)}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition-opacity hover:opacity-90"
                  >
                    {t("confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelConfirm(c)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            ))}
            {plans.map((pl) => (
              <div key={pl.id} className="rounded-xl border border-brand/40 bg-brand/5 p-3">
                <p className="text-xs font-semibold text-foreground">{t("planTitle")}</p>
                {pl.title ? <p className="mt-0.5 text-sm font-medium">{pl.title}</p> : null}
                <ul className="mt-1.5 space-y-1">
                  {pl.steps.map((s, i) => (
                    <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                      <span className="text-brand">{i + 1}.</span>
                      <span>{s.summary}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => runPlan(pl)}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition-opacity hover:opacity-90"
                  >
                    {t("confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelPlan(pl)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            ))}
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
        onClick={toggleOpen}
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
