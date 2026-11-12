import "server-only";
import { env } from "@/lib/env";
import { extractBearer, keysMatch } from "@/lib/mcp/core";

/**
 * Guard of the read-only MCP endpoint (`/api/mcp` and `/api/mcp/<key>`).
 *
 * Like the cron routes, it is reachable from the public internet:
 * `src/proxy.ts` leaves `/api/*` alone, so this check is the only thing between
 * a caller and every organization's data. The key comes either in
 * `Authorization: Bearer <key>` (Claude Code) or as the last path segment
 * (a claude.ai connector only takes a URL).
 *
 * Fails closed: with no MCP_API_KEY set, nothing matches.
 */
export function isMcpAuthorized(req: Request, pathKey: string | null): boolean {
  const secret = env.MCP_API_KEY;
  return (
    keysMatch(pathKey, secret) ||
    keysMatch(extractBearer(req.headers.get("authorization")), secret)
  );
}
