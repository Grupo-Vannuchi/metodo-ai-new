import "server-only";

/**
 * Job registry. Each key maps to a handler invoked by `/api/jobs/<job>` after
 * the QStash signature is verified. New background work (dispatch a message,
 * run an extraction batch) is added here in P5/P6.
 *
 * Handlers must be idempotent — QStash may deliver a job more than once.
 */
export type JobHandler = (payload: unknown) => Promise<void>;

export const JOB_HANDLERS: Record<string, JobHandler> = {
  /** Health/echo job used to validate the queue pipeline end-to-end. */
  echo: async (payload) => {
    console.log("[job:echo]", JSON.stringify(payload));
  },
};
