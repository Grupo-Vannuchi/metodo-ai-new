"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/** Re-render the server page every `intervalMs` (5 s unless told otherwise) while `active`. */
export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(handle);
  }, [active, intervalMs, router]);
  return null;
}
