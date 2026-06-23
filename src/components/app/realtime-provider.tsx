"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

type Handler = () => void;
type RealtimeCtx = { subscribe: (event: string, handler: Handler) => () => void };

const RealtimeContext = createContext<RealtimeCtx | null>(null);

const EVENTS = ["notifications", "inbox", "teamChat", "crm", "tasks", "feed"] as const;

/**
 * Single Server-Sent Events connection for the whole app. Widgets subscribe to
 * the channels they care about via `useRealtime` and refetch when one fires.
 * The browser's EventSource auto-reconnects; on every (re)connect we resync all
 * channels so nothing missed while offline slips through.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const subs = useRef<Map<string, Set<Handler>>>(new Map());

  const subscribe = useCallback((event: string, handler: Handler) => {
    let set = subs.current.get(event);
    if (!set) {
      set = new Set();
      subs.current.set(event, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }, []);

  useEffect(() => {
    const fire = (event: string) =>
      subs.current.get(event)?.forEach((h) => {
        try {
          h();
        } catch {
          /* ignore */
        }
      });
    const resyncAll = () => subs.current.forEach((set) => set.forEach((h) => {
      try {
        h();
      } catch {
        /* ignore */
      }
    }));

    const es = new EventSource("/api/realtime");
    es.addEventListener("ready", resyncAll);
    for (const ev of EVENTS) es.addEventListener(ev, () => fire(ev));

    return () => es.close();
  }, []);

  return <RealtimeContext.Provider value={{ subscribe }}>{children}</RealtimeContext.Provider>;
}

/** Run `handler` whenever the given realtime channel fires (and on reconnect). */
export function useRealtime(event: (typeof EVENTS)[number], handler: Handler) {
  const ctx = useContext(RealtimeContext);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(event, () => ref.current());
  }, [ctx, event]);
}
