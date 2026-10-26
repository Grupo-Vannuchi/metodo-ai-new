import { handleMcpRequest } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string }> };

/**
 * Read-only MCP server with the key as the last path segment — the form a
 * claude.ai connector needs, since it only takes a URL. Same handler as
 * /api/mcp: src/lib/mcp/handler.ts · docs/guia/05-rotas-e-jobs.md.
 */
async function handle(req: Request, { params }: Params) {
  const { key } = await params;
  return handleMcpRequest(req, key);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
