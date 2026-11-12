/**
 * Pure retry policy for Resend failures (no server imports, so check:email can
 * import it). Callers keep a SEPARATE attempt counter per failure class
 * (429, 5xx/network, 409-concurrent): one class never eats another's budget.
 */

export type ResendFailureAction = "retry_same_key" | "per_recipient" | "pause" | "fail_recipient";

const CONCURRENT = "concurrent_idempotent_requests";

function common(status: number, name: string | null, attempt: number): ResendFailureAction | null {
  if (status === 409 && name === CONCURRENT) return attempt < 5 ? "retry_same_key" : "pause";
  if (status === 429) return attempt < 5 ? "retry_same_key" : "pause";
  if (status === 0 || status >= 500) return attempt < 3 ? "retry_same_key" : "pause";
  if (status === 401 || status === 403) return "pause";
  return null;
}

/** A whole batch call failed. */
export function batchFailureAction(status: number, name: string | null, attempt: number): ResendFailureAction {
  const c = common(status, name, attempt);
  if (c) return c;
  // 400/422/409 (other): a bad address or a changed batch — go one by one.
  if (status === 400 || status === 422 || status === 409) return "per_recipient";
  return "pause";
}

/** A single-recipient call failed. */
export function singleFailureAction(status: number, name: string | null, attempt: number): ResendFailureAction {
  return common(status, name, attempt) ?? "fail_recipient";
}
