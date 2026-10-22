import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { env } from "@/lib/env";
import { isMcpAuthorized } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";
import { makeRateLimiter } from "@/lib/ratelimit";

/**
 * Entry point of both MCP routes (`/api/mcp` and `/api/mcp/[key]`).
 *
 * - A missing or wrong key gets a bare 404, never 401: claude.ai treats a 401
 *   as "start the OAuth flow", and this server has no OAuth.
 * - Only POST carries MCP messages. GET (the optional server-to-client SSE
 *   stream) and DELETE (session end) are refused with 405: the transport is
 *   stateless and answers in plain JSON, because every merge to `main`
 *   restarts Passenger and would cut any long-lived stream anyway.
 * - Each request gets its own server + transport, so concurrent calls never
 *   share JSON-RPC ids.
 */
export async function handleMcpRequest(req: Request, pathKey: string | null): Promise<Response> {
  if (!isMcpAuthorized(req, pathKey)) return new Response("Not Found", { status: 404 });

  if (req.method !== "POST") {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  // One shared budget: a single key, a single user. Separate per environment
  // so a local e2e run never eats production's allowance.
  const limiter = makeRateLimiter(`mcp:${env.NODE_ENV}`, 120, 60);
  if (limiter) {
    const { success } = await limiter.limit("all");
    if (!success) {
      return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "60" } });
    }
  }

  const server = buildMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}
