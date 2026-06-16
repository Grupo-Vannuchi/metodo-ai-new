"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/** Refreshes the job page while the extraction is still in progress. */
export function ExtractionPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
