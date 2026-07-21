import express, { type Express, type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  createAuthenticator,
  createRateLimiter,
  hasValidKeyFormat,
  safeKeyPrefix,
  type Authenticator,
  type AuthContext,
  type RateLimiter,
} from "./auth.ts";
import {
  countPendingJobs,
  createServiceClient,
  findActiveKeyByHash,
  touchLastUsed,
} from "./db.ts";
import { metrics } from "./metrics.ts";
import { ALL_TOOLS, registerAll, type RegisteredTool } from "./tools/index.ts";
import { registerPrompts } from "./prompts.ts";

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
  /**
   * Per-IP flood throttle, consulted in the POST handler AFTER the format gate and
   * BEFORE authenticate (which owns the DB lookup) — so a throttled request performs
   * ZERO DB reads. Optional: when omitted the gate is skipped and requests flow as
   * before (existing DB-free unit tests inject no throttle). The production root
   * wires one keyed by client IP.
   */
  readonly ipThrottle?: RateLimiter;
  /**
   * The MCP tools to advertise (tools/list) and dispatch (tools/call). The production
   * composition root wires the full set (ALL_TOOLS); DB-free unit tests inject their
   * own array, or omit it entirely — in which case tools/list is empty and no handler
   * ever touches the database.
   */
  readonly tools?: readonly RegisteredTool[];
  /**
   * Backlog reader for the `/status` operator signal: the count of `queued`+`running`
   * jobs. Optional and injected exactly like ipThrottle above — the production root wires
   * the DB-backed countPendingJobs; DB-free unit tests omit it, in which case `/status`
   * reports pendingJobs:null and no handler touches the database. The `/status` handler
   * always calls this through readPendingJobsBounded, so a slow/failing read degrades to
   * null instead of hanging or 5xx-ing the endpoint.
   */
  readonly pendingJobs?: () => Promise<number>;
}

/** res.locals key holding the resolved tenant context (set on the authenticated path). */
const AUTH_CONTEXT_LOCAL = "authContext";

/**
 * Typed accessor for the tenant context the auth gate stashed in res.locals. Throws if
 * absent — the tool-dispatch path is only reached PAST authenticate, so a miss is a
 * programming error, not a runtime condition. Confining the untyped res.locals string-key
 * read to this one function keeps it from leaking into the tool layer, which sees only
 * the typed AuthContext.
 */
export function getAuthContext(res: Response): AuthContext {
  const context = (res.locals as Record<string, unknown>)[AUTH_CONTEXT_LOCAL];
  if (context === undefined) {
    throw new Error(
      "auth context missing from res.locals (authenticate must run before tool dispatch)",
    );
  }
  return context as AuthContext;
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
    // Per-IP invalid-key flood throttle (consulted in the POST handler), keyed by
    // client IP. Capacity/refill rationale: the per-key allowance is 60/min (1/s
    // refill); per-IP steady-state 4/s is 4x that, so a single legitimate user is
    // never bound by the IP gate before their own per-key limit, and a NAT sharing up
    // to ~4 heavy users stays clear — beyond that is an accepted beta limitation. The
    // 240 burst mirrors the 4x ratio of the per-key 60 burst. maxEntries bounds memory
    // under an IP-rotating flood. App-level in-memory (not the Fly edge) is deliberate:
    // Fly Proxy's http_service exposes machine concurrency backpressure, not
    // per-client-IP rate limits, so an edge-level throttle would require an external
    // WAF/CDN — out of scope for beta. This shares the per-key limiter's accepted
    // per-process limitation (a multi-instance deployment throttles per instance).
    ipThrottle: createRateLimiter({ capacity: 240, refillPerSecond: 4, maxEntries: 10_000 }),
    tools: ALL_TOOLS,
    // Backlog count for /status, over the SAME service client. Read-only, non-tenant
    // aggregate (see countPendingJobs); the /status handler bounds it so a slow DB can
    // never hang the operator endpoint.
    pendingJobs: () => countPendingJobs(client),
  };
}

/**
 * Upper bound (ms) on the `/status` pending-jobs read. Past this the endpoint reports
 * pendingJobs:null rather than waiting: `/status` is an operator signal, not a liveness
 * gate, so a slow DB must degrade it, never hang it. Short by design — an operator polling
 * `/status` wants a fast answer even when the DB is the thing that is unwell.
 */
const STATUS_PENDING_TIMEOUT_MS = 1_000;

/**
 * Read the pending-jobs backlog for `/status`, made SAFE for an operator signal: bounded by
 * `timeoutMs` and swallowing ANY reader failure — a rejecting promise OR a SYNCHRONOUS throw
 * — so a slow or broken DB resolves to `null` instead of hanging or 5xx-ing `/status`.
 * Returns null when no reader is wired (DB-free tests inject none). The reader is invoked
 * INSIDE `.then(read)` (not called directly), so a synchronous throw becomes a rejection and
 * folds to null exactly like an async rejection would — the route's charter is to survive
 * any reader behavior. Folding here (via `.catch`, not left to Promise.race) also means a
 * rejection arriving AFTER the timeout already won is handled, never an unhandled rejection
 * (fatal under Node's default policy). Exported so the never-hang guarantee is unit-testable
 * directly with a short bound.
 */
export async function readPendingJobsBounded(
  read: (() => Promise<number>) | undefined,
  timeoutMs: number,
): Promise<number | null> {
  if (!read) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const counted = Promise.resolve()
    .then(read) // deferred invocation: a synchronous throw in read becomes a rejection here
    .catch((error: unknown) => {
      console.warn(`/status pendingJobs read failed: ${errorMessage(error)}`);
      return null;
    });
  try {
    return await Promise.race([counted, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

/** Header Fly's edge proxy SETS to the real client IP, overwriting any client-sent value. */
const FLY_CLIENT_IP_HEADER = "fly-client-ip";
/** IPv4-mapped IPv6 prefix — stripped so ::ffff:1.2.3.4 and 1.2.3.4 share one bucket key. */
const IPV4_MAPPED_PREFIX = "::ffff:";

/** Normalize an IPv4-mapped IPv6 address (::ffff:1.2.3.4) to its bare IPv4 form. */
function normalizeIp(ip: string): string {
  return ip.startsWith(IPV4_MAPPED_PREFIX) ? ip.slice(IPV4_MAPPED_PREFIX.length) : ip;
}

/**
 * Best-effort client IP, used ONLY as the per-IP flood-throttle bucket key. Prefers
 * the Fly-Client-IP header, which Fly's edge proxy sets/overwrites for proxied traffic
 * (edge-authoritative); a direct internal-network (6PN) caller could forge it, which is
 * acceptable because reaching 6PN already means being inside the trust boundary. We
 * deliberately do NOT use req.ip / trust-proxy / X-Forwarded-For: XFF is
 * client-appendable, so its leftmost value is forgeable, whereas Fly-Client-IP is the
 * header the edge controls. Falls back to the socket peer address (local dev / tests),
 * then the literal "unknown" (missing both -> one shared, still-bounded bucket). Never
 * returns undefined, so the bucket key is always a stable string.
 */
function clientIpOf(req: Request): string {
  const header = req.headers[FLY_CLIENT_IP_HEADER];
  const flyIp = Array.isArray(header) ? header[0] : header;
  return normalizeIp(flyIp ?? req.socket.remoteAddress ?? "unknown");
}

/**
 * A stateless MCP server for one request: it advertises `tools` (tools/list) and
 * dispatches them under the credit guard (tools/call), both scoped to `ctx`, plus the
 * static orchestration `prompts` (prompts/list + prompts/get, tenant-independent). The
 * low-level Server is used (not McpServer) so an empty `tools` yields tools/list []
 * — the shape the DB-free gateway tests inject. registerAll derives the tools/list
 * JSON Schema from each tool's zod schema; registerPrompts wires the prompts surface.
 */
function createMcpServer(ctx: AuthContext, tools: readonly RegisteredTool[]): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {}, prompts: {} } });
  registerAll(server, { ctx, tools });
  registerPrompts(server);
  return server;
}

/**
 * Handle one MCP request in stateless mode: a fresh Server + transport per HTTP
 * request, both torn down when the response closes. The per-request server is built
 * with this request's tenant context (read once here via getAuthContext, so res.locals
 * never reaches the tool layer) and the injected tool set. JSON responses are enabled
 * because the gateway has no server-initiated streaming.
 */
async function handleMcpRequest(
  req: Request,
  res: Response,
  tools: readonly RegisteredTool[],
): Promise<void> {
  const server = createMcpServer(getAuthContext(res), tools);
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
      metrics.recordServerError(); // count the 5xx so /status.errorsSinceBoot reflects it
      res.status(500).json(jsonRpcError(JSON_RPC_INTERNAL_ERROR, "Internal server error"));
    }
  }
}

/**
 * Build the MCP gateway HTTP app: a health probe plus the personal MCP endpoint.
 * `deps` (authenticate, the per-IP ipThrottle, and tools) are injected; the default
 * wires the real DB-backed collaborators, while tests pass fakes to run without a DB.
 */
export function createApp(deps: AppDeps = buildDefaultDeps()): Express {
  const app = express();
  app.use(express.json());

  // Liveness probe for Fly health checks and load balancers.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Operator status signal — deliberately SEPARATE from /healthz. /healthz stays a trivial
  // zero-I/O liveness probe wired to the Fly health check (fly.toml, every 15s / 2s timeout)
  // AND the external uptime monitor; adding a DB read there would let a slow DB fail the
  // check and have Fly kill an otherwise-healthy machine. /status carries the richer signals
  // and is NOT wired to any health check, so its DB read can never endanger liveness.
  // Unauthenticated on purpose: it exposes only COARSE, PROCESS-WIDE operational counts
  // (uptime, 5xx-since-boot, and the global queued+running backlog) — no tenant data and
  // nothing per-user — so it is as safe to expose as /healthz. The backlog read is bounded
  // and best-effort (readPendingJobsBounded): on a slow/broken DB it degrades to
  // pendingJobs:null and STILL answers ok:true, so /status never hangs or returns 5xx.
  app.get("/status", async (_req, res) => {
    const pendingJobs = await readPendingJobsBounded(deps.pendingJobs, STATUS_PENDING_TIMEOUT_MS);
    res.json({ ok: true, ...metrics.snapshot(), pendingJobs });
  });

  // Personal MCP endpoint — Streamable HTTP, stateless. POST carries JSON-RPC.
  // Gate order: sg_ format (cheap, no I/O) -> per-IP flood throttle (in-memory, no
  // I/O; a throttled request never reaches the DB) -> auth decision (lookup ->
  // per-key rate limit -> stamp, see auth.ts — an over-limit request costs at most
  // one read and zero writes) -> dispatch. Unknown and revoked keys are
  // indistinguishable (401); an IP-throttled and a key-throttled request likewise
  // share one 429 envelope, so neither leaks a probing signal.
  // The whole async pipeline is caught here: Express 4 does not handle async
  // rejections, so an uncaught one (e.g. a transient DB outage inside authenticate)
  // would leave the response hanging AND crash the process (Node's default
  // unhandled-rejection policy). Failures answer 500 with the same JSON-RPC
  // envelope; the log carries at most the safe key prefix, never the plaintext key.
  app.post("/mcp/:key", async (req, res) => {
    const key = keyOrReject(req, res);
    if (key === null) return;

    // Per-IP flood throttle BEFORE authenticate: a well-formed-but-invalid key still
    // costs one api_keys read inside authenticate, so an unauthenticated flood is
    // capped here by client IP first. A denied request answers the SAME 429 envelope
    // as the per-key limiter (indistinguishable) and performs ZERO DB reads. Skipped
    // when no throttle is injected (DB-free unit tests).
    if (deps.ipThrottle && !deps.ipThrottle.tryConsume(clientIpOf(req))) {
      res.status(429).json(jsonRpcError(JSON_RPC_RATE_LIMITED, "Rate limit exceeded"));
      return;
    }

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
      // registry reads it back via getAuthContext to scope tool execution per tenant.
      res.locals[AUTH_CONTEXT_LOCAL] = decision.context;
      await handleMcpRequest(req, res, deps.tools ?? []);
    } catch (error) {
      console.error(`MCP request failed for ${safeKeyPrefix(key)}: ${errorMessage(error)}`);
      if (!res.headersSent) {
        metrics.recordServerError(); // count the 5xx so /status.errorsSinceBoot reflects it
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
