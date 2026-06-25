import "server-only";
import { Client, Receiver } from "@upstash/qstash";
import { env } from "@/lib/env";

/**
 * Background-job queue (Upstash QStash). Jobs are HTTP callbacks to
 * `/api/jobs/<job>`; QStash handles retries, delays and signing. When QStash
 * isn't configured (`QSTASH_TOKEN` absent) `enqueue` throws a clear error —
 * callers should check `isQueueConfigured()` for graceful degradation.
 */
let client: Client | null = null;

export function isQueueConfigured(): boolean {
  return Boolean(env.QSTASH_TOKEN);
}

function getClient(): Client {
  if (!env.QSTASH_TOKEN) {
    throw new Error("Queue not configured: set QSTASH_TOKEN");
  }
  // baseUrl pins the QStash region endpoint (e.g. https://qstash-us-east-1
  // .upstash.io). Without it the SDK may route to the wrong region and reject
  // the token ("user not found in this region"). Undefined → SDK default.
  client ??= new Client({ token: env.QSTASH_TOKEN, baseUrl: env.QSTASH_URL });
  return client;
}

export type EnqueueOptions = {
  /** Delay before the job runs, in seconds. */
  delaySeconds?: number;
  /** Idempotency key — QStash dedupes identical messages. */
  deduplicationId?: string;
};

/** Publish a job to be processed by `app/api/jobs/<job>/route.ts`. */
export async function enqueue(
  job: string,
  body: unknown,
  opts: EnqueueOptions = {},
): Promise<void> {
  const url = `${env.NEXT_PUBLIC_SITE_URL}/api/jobs/${job}`;
  await getClient().publishJSON({
    url,
    body,
    delay: opts.delaySeconds,
    deduplicationId: opts.deduplicationId,
  });
}

/**
 * Verify a QStash request signature in a job route. Returns false when signing
 * keys aren't configured or the signature doesn't match (so the route can 401).
 */
export async function verifyQStashSignature(
  body: string,
  signature: string | null,
): Promise<boolean> {
  if (
    !env.QSTASH_CURRENT_SIGNING_KEY ||
    !env.QSTASH_NEXT_SIGNING_KEY ||
    !signature
  ) {
    return false;
  }
  const receiver = new Receiver({
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
  });
  try {
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}
