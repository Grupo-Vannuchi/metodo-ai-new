import "server-only";
import { dispatchCampaignBatch } from "@/lib/dispatch";
import { runExtractionBatch } from "@/lib/prospecting/runner";
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

  /** Send one batch of a campaign, then re-enqueue until complete. */
  "dispatch-campaign": async (payload) => {
    const campaignId = String((payload as { campaignId?: string })?.campaignId ?? "");
    if (!campaignId) return;
    const { done, retryAfter } = await dispatchCampaignBatch(campaignId);
    if (!done && isQueueConfigured()) {
      await enqueue(
        "dispatch-campaign",
        { campaignId },
        retryAfter ? { delaySeconds: retryAfter } : {},
      );
    }
  },

  /** Run one prospecting batch (one Places page), then re-enqueue until done. */
  "extraction-run": async (payload) => {
    const jobId = String((payload as { jobId?: string })?.jobId ?? "");
    if (!jobId) return;
    const { done } = await runExtractionBatch(jobId);
    if (!done && isQueueConfigured()) {
      await enqueue("extraction-run", { jobId });
    }
  },
};
