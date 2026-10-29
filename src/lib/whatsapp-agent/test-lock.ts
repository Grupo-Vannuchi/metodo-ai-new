/**
 * TEMPORARY test lock (29/10/2026). On the connections listed here the WhatsApp AI
 * agent only answers the listed numbers; anyone else gets no bot reply (the
 * message still lands in the inbox). Delete the entry, or this file and its one
 * call in pipeline.ts, to open the agent to everyone again.
 */
const AGENT_TEST_NUMBERS: Record<string, readonly string[]> = {
  // NILLOW's number (agent "N8tão"): only Rafael's phone, with and without the
  // 9th digit, since WhatsApp may send either form for a Brazilian mobile.
  cmuh6jbhj001hvq40rotj0vzv: ["5513981427399", "551381427399"],
};

/** True when this connection has a test lock and the sender isn't on it. */
export function blockedByAgentTestLock(connectionId: string, remoteJid: string): boolean {
  const allowed = AGENT_TEST_NUMBERS[connectionId];
  if (!allowed) return false;
  return !allowed.includes(remoteJid.split("@")[0]);
}
