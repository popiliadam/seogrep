import express, { type Express, type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createAuthenticator,
  createRateLimiter,
  hasValidKeyFormat,
  safeKeyPrefix,
  type Authenticator,
} from "./auth.ts";
import { createServiceClient, findActiveKeyByHash, touchLastUsed } from "./db.ts";

/** Advertised MCP server identity. */
const SERVER_INFO = { name: "seogrep-mcp", version: "0.0.1" } as const;

/** JSON-RPC error codes returned before a request reaches the MCP server. */
const JSON_RPC_UNAUTHORIZED = -32001;
const JSON_RPC_METHOD_NOT_ALLOWED = -32000;
const JSON_RPC_RATE_LIMITED = -32002;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Injected collaborators for the gateway app. Fakes are supplied by unit tests. */
export interface AppDeps {
  readonly authenticate: Authenticator;
}

/**
 * Wire the production dependencies (composition root). This is the ONLY code that
 * reads the service-role env and builds the DB client, and it is evaluated ONLY
 * when createApp is called without explicit deps (the real entrypoint). Unit tests
 * pass fakes, so they never touch the database or the environment. The per-key
 * rate limiter is wired INSIDE the authenticator (between lookup and stamp) so an
 * over-limit request never reaches the last_used_at write.
 */
function buildDefaultDeps(): AppDeps {
  const client = createServiceClient();
  return {
    authenticate: createAuthenticator({
      lookup: (keyHash) => findActiveKeyByHash(client, keyHash),
      stamp: (keyId, at) => touchLastUsed(client, keyId, at),
      rateLimiter: createRateLimiter(),
    }),
  };
}

/**
 * Return the sg_-format key from the route, or send a 401 JSON-RPC error and
 * return null. The route param is `string | undefined` under
 * noUncheckedIndexedAccess, so a missing key also fails the gate. The sg_ shape is
 * public (not a secret), so a distinct "format" message here is not an info leak;
 * unknown vs revoked, which ARE sensitive, share one message downstream.
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
    // Best-effort teardown. Swallow (log-only) any close rejection: an unhandled promise
    // rejection is fatal under Node's default policy, so a failing close must not escape.
    // No plaintext key is in scope on this path, so the error is safe to log verbatim.
    transport.close().catch((error) => {
      console.error("MCP transport close failed:", error);
    });
    server.close().catch((error) => {
      console.error("MCP server close failed:", error);
    });
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
 * `deps` (authenticate + rateLimiter) are injected; the default wires the real
 * DB-backed collaborators, while tests pass fakes to run without a database.
 */
export function createApp(deps: AppDeps = buildDefaultDeps()): Express {
  const app = express();
  app.use(express.json());

  // Liveness probe for Fly health checks and load balancers.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Personal MCP endpoint — Streamable HTTP, stateless. POST carries JSON-RPC.
  // Gate order: sg_ format (cheap, no I/O) -> auth decision (lookup -> per-key
  // rate limit -> stamp, see auth.ts — an over-limit request costs at most one
  // read and zero writes) -> dispatch. Unknown and revoked keys are
  // indistinguishable (401).
  // The whole async pipeline is caught here: Express 4 does not handle async
  // rejections, so an uncaught one (e.g. a transient DB outage inside authenticate)
  // would leave the response hanging AND crash the process (Node's default
  // unhandled-rejection policy). Failures answer 500 with the same JSON-RPC
  // envelope; the log carries at most the safe key prefix, never the plaintext key.
  app.post("/mcp/:key", async (req, res) => {
    const key = keyOrReject(req, res);
    if (key === null) return;

    try {
      const decision = await deps.authenticate(key);
      if (decision.status === "unauthorized") {
        res.status(401).json(jsonRpcError(JSON_RPC_UNAUTHORIZED, "Invalid API key"));
        return;
      }
      if (decision.status === "rate_limited") {
        res.status(429).json(jsonRpcError(JSON_RPC_RATE_LIMITED, "Rate limit exceeded"));
        return;
      }

      // Carry the tenant context in Express request scope (no global state). The tool
      // registry (T5) reads res.locals.authContext to scope tool execution per tenant.
      res.locals.authContext = decision.context;
      await handleMcpRequest(req, res);
    } catch (error) {
      console.error(`MCP request failed for ${safeKeyPrefix(key)}: ${errorMessage(error)}`);
      if (!res.headersSent) {
        res.status(500).json(jsonRpcError(JSON_RPC_INTERNAL_ERROR, "Internal server error"));
      }
    }
  });

  // GET (SSE) and DELETE (session end) are unsupported in stateless mode; reject
  // after the same key-format gate so clients get a consistent 401 on bad keys.
  // These transport methods carry no request body to dispatch, so they stop at the
  // format gate and never perform key authentication.
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
