import "server-only";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSensitiveKeys, McpInputError } from "@/lib/mcp/core";
import { getOrganizationRef } from "@/lib/queries/mcp/plataforma";

export type OrgRef = { id: string; name: string };

/**
 * One read-only tool. `scope: "org"` tools get a required `organizationId`
 * prepended to their input and receive the checked organization; the only
 * `global` tool is `listar_organizacoes`.
 */
export type McpToolDef = {
  name: string;
  description: string;
  input: z.ZodRawShape;
  scope: "global" | "org";
  run: (args: Record<string, unknown>, org: OrgRef | null, now: Date) => Promise<unknown>;
};

export function globalTool<S extends z.ZodRawShape>(d: {
  name: string;
  description: string;
  input: S;
  run: (args: z.infer<z.ZodObject<S>>, now: Date) => Promise<unknown>;
}): McpToolDef {
  return {
    name: d.name,
    description: d.description,
    input: d.input,
    scope: "global",
    run: (args, _org, now) => d.run(args as z.infer<z.ZodObject<S>>, now),
  };
}

export function orgTool<S extends z.ZodRawShape>(d: {
  name: string;
  description: string;
  input: S;
  run: (args: z.infer<z.ZodObject<S>>, org: OrgRef, now: Date) => Promise<unknown>;
}): McpToolDef {
  return {
    name: d.name,
    description: d.description,
    input: d.input,
    scope: "org",
    // registerTools only calls an org tool after resolving its organization.
    run: (args, org, now) => d.run(args as z.infer<z.ZodObject<S>>, org as OrgRef, now),
  };
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const organizationIdParam = z
  .string()
  .min(1)
  .describe("Id da organização (use listar_organizacoes para achar)");

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** The first line of an error, which never carries query arguments (Prisma prints those below it). */
const firstLine = (err: unknown) =>
  err instanceof Error ? `${err.name}: ${err.message.split("\n")[0]}` : "erro desconhecido";

async function runTool(def: McpToolDef, args: Record<string, unknown>): Promise<ToolResult> {
  const started = Date.now();
  const organizationId = def.scope === "org" ? String(args.organizationId) : null;
  let ok = false;
  try {
    let org: OrgRef | null = null;
    if (organizationId) {
      org = await getOrganizationRef(organizationId);
      if (!org) {
        return errorResult(
          `Organização não encontrada: ${organizationId}. Use listar_organizacoes para ver os ids.`,
        );
      }
    }
    const result = await def.run(args, org, new Date());
    const payload = org ? { organization: org, ...(result as object) } : result;
    // Last gate: whatever a query selected by mistake, a sensitive field never leaves.
    const leaked = findSensitiveKeys(payload);
    if (leaked.length) {
      console.error("[mcp] campo sensível bloqueado", def.name, leaked);
      return errorResult("Resposta bloqueada: campo sensível na saída.");
    }
    ok = true;
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  } catch (err) {
    if (err instanceof McpInputError) return errorResult(err.message);
    console.error("[mcp] erro", def.name, firstLine(err));
    return errorResult(`Erro interno ao consultar ${def.name}.`);
  } finally {
    // Never the key, the URL or search arguments — only what and how long.
    console.info("[mcp]", JSON.stringify({ tool: def.name, organizationId, ms: Date.now() - started, ok }));
  }
}

export function registerTools(server: McpServer, defs: McpToolDef[]): void {
  for (const def of defs) {
    const inputSchema = def.scope === "org" ? { organizationId: organizationIdParam, ...def.input } : def.input;
    server.registerTool(
      def.name,
      { description: def.description, inputSchema, annotations: READ_ONLY },
      // The SDK types each callback from that tool's own schema; this list is
      // heterogeneous, so the args arrive here as a plain record.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((args: Record<string, unknown>) => runTool(def, args)) as any,
    );
  }
}
