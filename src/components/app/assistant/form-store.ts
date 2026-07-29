import { useEffect } from "react";
import type { FormBridge } from "@/lib/assistant/form-bridge";

/**
 * A tiny external store for the currently-open form bridge. Using an external
 * store (read via useSyncExternalStore in the widget) instead of React context
 * avoids a synchronous setState-in-effect when a form registers. Client-only —
 * mutated exclusively inside effects.
 */
let active: FormBridge | null = null;
const listeners = new Set<() => void>();

export function getActiveForm(): FormBridge | null {
  return active;
}

export function subscribeForm(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function setActive(bridge: FormBridge | null) {
  active = bridge;
  listeners.forEach((l) => l());
}

/** A form registers itself while mounted; the last one to mount wins. */
export function useRegisterAssistantForm(bridge: FormBridge): void {
  useEffect(() => {
    setActive(bridge);
    return () => {
      if (active === bridge) setActive(null);
    };
  }, [bridge]);
}
