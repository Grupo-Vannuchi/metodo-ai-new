import { isCronAuthorized, cronUnauthorized } from "@/lib/cron-auth";
import { errorTag, findDueGroupAddRuns, groupAddRuntime, kickGroupAddRun } from "@/lib/whatsapp/group-add/runner";

export const runtime = "nodejs";

/**
 * Takes up the "Adicionar a grupo do WhatsApp" rounds that stopped (external cron, every 5 minutes — see README §8;
 * recommended). A round waits without a runner for the hour to come (08:00), for the cap of the day to free, for an
 * Evolution that did not answer, or after a restart of the server; nothing sleeps for hours in the process. This lists
 * what is due (findDueGroupAddRuns: also takes back a round paused because the number was closed, or the group
 * unreadable, once they are fine again, and starts the oldest queued round of a number nobody holds) and kicks each.
 *
 * Unlike the campaigns and extractions crons it is NOT a no-op without a queue: production has none, and
 * kickGroupAddRun falls back to after() in this process. A round whose runner still holds the lease is not listed, so a
 * tick that comes while one works does not start a second runner. The time comes from groupAddRuntime.now() (a plain
 * `new Date()` in production), the clock the runner stamps its leases with, so the lease and the check agree.
 * System context: it reads the rounds of every organization and only ids come out of it. Protected by CRON_SECRET
 * (see lib/cron-auth).
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return cronUnauthorized();

  const due = await findDueGroupAddRuns(groupAddRuntime.now());
  let resumed = 0;
  for (const id of due) {
    // One round that can't be kicked (the queue refuses it) does not keep the others waiting; the next tick tries it again.
    try {
      await kickGroupAddRun(id);
      resumed++;
    } catch (e) {
      console.error("[group-add] cron could not kick a run", id, errorTag(e));
    }
  }

  return Response.json({ ok: true, resumed });
}
