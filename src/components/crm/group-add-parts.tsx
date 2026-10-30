"use client";

import { Spinner } from "@/components/ui/spinner";
import type { GroupAddActionError } from "@/app/actions/whatsapp-group-add";

/** Small pieces the screens of the "Adicionar a grupo do WhatsApp" dialog share. */

/** The two errors that are answered by going to Conversas, where the number is connected. */
export const NEEDS_INBOX: readonly GroupAddActionError[] = ["no_connection", "disconnected"];

export function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      {text}
    </div>
  );
}

/** A box with a note the member should read before going on (amber, with its icon). */
export function Notice({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-sm">
      <span className="mt-0.5 shrink-0 text-amber-500">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
