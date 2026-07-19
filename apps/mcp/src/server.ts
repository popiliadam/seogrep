import express, { type Express, type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** Advertised MCP server identity. */
const SERVER_INFO = { name: "seogrep-mcp", version: "0.0.1" } as const;

/** Personal-API-key prefix (see packages/core keys). T1 checks the FORMAT only. */
const API_KEY_PREFIX = "sg_";

/** JSON-RPC error codes returned before a request reaches the MCP server. */
const JSON_RPC_UNAUTHORIZED = -32001;
const JSON_RPC_METHOD_NOT_ALLOWED = -32000;
const JSON_RPC_INTERNAL_ERROR = -32603;

interface JsonRpcErrorBody {
  readonly jsonrpc: "2.0";
  readonly error: { readonly code: number; readonly message: string };
  readonly id: null;
}

/** Build a JSON-RPC 2.0 error envelope. `id` is null for pre-dispatch failures. */
function jsonRpcError(code: number, message: string): JsonRpcErrorBody {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

/**
 * True when `key` has the personal-API-key shape (sg_ prefix + non-empty body).
 * This is a FORMAT gate only — real key verification and tenant resolution
 * arrive in T2. Exported for unit testing.
 */
export function hasValidKeyFormat(key: string): boolean {
  return key.startsWith(API_KEY_PREFIX) && key.length > API_KEY_PREFIX.length;
}

/**
 * Return the sg_-format key from the route, or send a 401 JSON-RPC error and
 * return null. The route param is `string | undefined` under
 * noUncheckedIndexedAccess, so a missing key also fails the gate.
 */
function keyOrReject(req: Request, res: Response): string | null {
  const key = req.params.key;
  if (typeof key !== "string" || !hasValidKeyFormat(key)) {
    res.status(401).json(jsonRpcError(JSON_RPC_UNAUTHORIZED, "Invalid API key format"));
    return null;
  }
  return key;
}

/**
 * A stateless MCP server that advertises tools support and returns an empty tool
 * list. Tool registration + credit metering land in later tasks. The low-level
 * Server is used (not McpServer) so tools/list responds with [] even with no
 * tool registered.
 */
function createMcpServer(): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  return server;
}

/**
 * Handle one MCP request in stateless mode: a fresh Server + transport per HTTP
 * request, both torn down when the response closes. JSON responses are enabled
 * because the T1 gateway has no server-initiated streaming.
 */
async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request handling failed:", error);
    if (!res.headersSent) {
      res.status(500).json(jsonRpcError(JSON_RPC_INTERNAL_ERROR, "Internal server error"));
    }
  }
}

/**
 * Build the MCP gateway HTTP app: a health probe plus the personal MCP endpoint.
 * No key AUTHENTICATION yet (T2) — only the sg_ format is checked here.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // Liveness probe for Fly health checks and load balancers.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Personal MCP endpoint — Streamable HTTP, stateless. POST carries JSON-RPC.
  app.post("/mcp/:key", async (req, res) => {
    if (keyOrReject(req, res) === null) return;
    await handleMcpRequest(req, res);
  });

  // GET (SSE) and DELETE (session end) are unsupported in stateless mode; reject
  // after the same key-format gate so clients get a consistent 401 on bad keys.
  const rejectNonPost = (req: Request, res: Response): void => {
    if (keyOrReject(req, res) === null) return;
    res
      .status(405)
      .json(jsonRpcError(JSON_RPC_METHOD_NOT_ALLOWED, "Method not allowed in stateless mode"));
  };
  app.get("/mcp/:key", rejectNonPost);
  app.delete("/mcp/:key", rejectNonPost);

  return app;
}
