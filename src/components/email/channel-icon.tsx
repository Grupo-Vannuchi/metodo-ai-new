import Image from "next/image";
import { Server } from "lucide-react";
import { ProviderMark } from "@/components/auth/provider-mark";
import type { ListChannel } from "@/lib/email-broadcast/list-channel";
import { cn } from "@/lib/utils";

/**
 * The provider's mark for a sending channel: MétodoAI's "M" for the platform,
 * the official Microsoft squares or Google "G" for the company's own mailbox,
 * and a generic mail-server icon for an SMTP account (any provider).
 * Decorative (the channel name is always written next to it). No hooks:
 * Server or Client.
 */
export function ChannelIcon({ channel, className }: { channel: ListChannel; className?: string }) {
  if (channel === "microsoft") return <ProviderMark provider="microsoft" className={cn("size-5", className)} />;
  if (channel === "google") return <ProviderMark provider="google" className={cn("size-5", className)} />;
  if (channel === "smtp") return <Server aria-hidden="true" className={cn("size-5 text-brand", className)} />;
  return <Image src="/logo-mark.png" alt="" width={100} height={100} className={cn("size-5", className)} />;
}
