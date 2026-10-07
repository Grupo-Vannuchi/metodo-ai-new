"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/** Re-render the server page every 5s while a send is running. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const handle = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(handle);
  }, [active, router]);
  return null;
}
