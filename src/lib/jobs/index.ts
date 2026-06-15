import "server-only";
import { runExtractionBatch } from "@/lib/extraction";
import { enqueue, isQueueConfigured } from "@/lib/queue";

/**
 * Job registry. Each key maps to a handler invoked by `/api/jobs/<job>` after
 * the QStash signature is verified.
 *
 * Handlers must be idempotent — QStash may deliver a job more than once.
 */
export type JobHandler = (payload: unknown) => Promise<void>;

export const JOB_HANDLERS: Record<string, JobHandler> = {
  /** Health/echo job used to validate the queue pipeline end-to-end. */
  echo: async (payload) => {
    console.log("[job:echo]", JSON.stringify(payload));
  },

  /**
   * Process one batch of an extraction job, then re-enqueue itself until the
   * job is complete (chunking — keeps each invocation short).
   */
  "extraction-run": async (payload) => {
    const jobId = String((payload as { jobId?: string })?.jobId ?? "");
    if (!jobId) return;
    const { done } = await runExtractionBatch(jobId);
    if (!done && isQueueConfigured()) {
      await enqueue("extraction-run", { jobId });
    }
  },
};
