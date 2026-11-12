import { handleMcpRequest } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only MCP server, key in `Authorization: Bearer <key>` (Claude Code).
 * A claude.ai connector, which only takes a URL, uses /api/mcp/<key> instead.
 * Guard and behavior: src/lib/mcp/handler.ts · docs/guia/05-rotas-e-jobs.md.
 */
export function POST(req: Request) {
  return handleMcpRequest(req, null);
}

export function GET(req: Request) {
  return handleMcpRequest(req, null);
}

export function DELETE(req: Request) {
  return handleMcpRequest(req, null);
}
