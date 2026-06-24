import { getOrgContext } from "@/lib/tenant";
import { realtimeFingerprints, REALTIME_EVENTS, type RealtimeFingerprint } from "@/lib/queries/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Recycle the stream under a minute, then let EventSource reconnect (which also
// resyncs every channel). Stays under common proxy idle timeouts (~60s on the
// Hostinger LiteSpeed proxy) and any serverless ceiling.
export const maxDuration = 60;

const TICK_MS = 2500;
const MAX_LIFETIME_MS = 55_000;

/**
 * Centralized realtime channel (Server-Sent Events). One connection per signed-in
 * tab replaces the old per-widget pollers. Every tick it recomputes cheap
 * fingerprints and emits an event only for channels that changed; the client
 * then refetches just that slice. A `ping` keeps the connection warm.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Tell the client how soon to reconnect after we close, and establish a
      // baseline so the first tick doesn't spuriously fire every channel.
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      let prev: RealtimeFingerprint;
      try {
        prev = await realtimeFingerprints(ctx.organizationId, ctx.userId);
      } catch {
        prev = {} as RealtimeFingerprint;
      }
      send("ready", { t: 1 });

      const startedAt = Date.now();
      const loop = async () => {
        if (closed) return;
        if (Date.now() - startedAt > MAX_LIFETIME_MS) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        try {
          const next = await realtimeFingerprints(ctx.organizationId, ctx.userId);
          for (const ev of REALTIME_EVENTS) {
            if (next[ev] !== prev[ev]) send(ev, { t: 1 });
          }
          prev = next;
          send("ping", { t: 1 });
        } catch {
          /* transient DB hiccup — keep the stream alive */
        }
        if (!closed) timer = setTimeout(loop, TICK_MS);
      };
      timer = setTimeout(loop, TICK_MS);
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
