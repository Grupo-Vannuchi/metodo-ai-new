"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * State remembered for the browsing session (sessionStorage): returning to a
 * screen restores where you were — the folder you had open, the page you were
 * on — without leaking into new tabs or surviving a browser restart, which is
 * what makes it feel like "where I left off" instead of a sticky setting.
 *
 * Built on `useSyncExternalStore` because sessionStorage is exactly that: an
 * external store. It gives the server (and the hydration pass) the initial
 * value and swaps in the stored one right after, with no setState inside an
 * effect and no hydration mismatch.
 *
 * Values are wrapped as `{ v }` so `undefined` survives the round-trip —
 * `JSON.stringify(undefined)` isn't valid JSON, and `undefined` is a meaningful
 * state here (it means "every folder closed").
 */

const listeners = new Set<() => void>();

/** Last parsed value per key, so `getSnapshot` returns a stable reference while
 * the raw string is unchanged — returning a fresh object every call would make
 * React re-render forever. */
const cache = new Map<string, { raw: string | null; value: unknown }>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function read<T>(key: string, initial: T): T {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    return initial; // private mode / storage disabled
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;

  let value = initial;
  if (raw !== null) {
    try {
      value = (JSON.parse(raw) as { v: T }).v;
    } catch {
      value = initial; // corrupt entry — fall back
    }
  }
  cache.set(key, { raw, value });
  return value;
}

export function useSessionState<T>(key: string, initial: T) {
  // The initial value is the fallback for every later read; keep the first one
  // so a re-render with a new literal can't change what "unset" means.
  const initialRef = useRef(initial);

  const value = useSyncExternalStore(
    subscribe,
    () => read(key, initialRef.current),
    () => initialRef.current,
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = read(key, initialRef.current);
      const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try {
        sessionStorage.setItem(key, JSON.stringify({ v: resolved }));
      } catch {
        // Storage unavailable or over quota — remembering is best-effort, but
        // the cache below still keeps this render tree in sync.
      }
      cache.set(key, { raw: JSON.stringify({ v: resolved }), value: resolved });
      for (const l of listeners) l();
    },
    [key],
  );

  // False on the server and during hydration, true once the stored value is in
  // play — for callers that must not act on the fallback (e.g. redirecting).
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return [value, setValue, hydrated] as const;
}
