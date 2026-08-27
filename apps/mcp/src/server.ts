import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { DEFAULT_MCP_URL_TEMPLATE, mcpUrlTemplate } from "@pseo/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MCP_APP_MIME, UI_RESOURCES } from "./ui/card.ts";
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
// Additive M-13 imports (cloud schema readiness) on their own lines, so every existing
// import line above stays byte-identical.
import { SCHEMA_SENTINEL_RPC, probeSchemaSentinel, type SchemaProbeResult } from "./db.ts";
import { metrics } from "./metrics.ts";
import { ALL_TOOLS, registerAll, type RegisteredTool } from "./tools/index.ts";
import { registerPrompts } from "./prompts.ts";
import { SERVER_CARD_CACHE_CONTROL, SERVER_CARD_PATH, buildServerCard } from "./server-card.ts";

/** Advertised MCP server identity. */
const SERVER_INFO = { name: "seogrep-mcp", version: "0.0.1" } as const;

/**
 * Capabilities advertised on the handshake. Hoisted to a single const because the public
 * capability card republishes them verbatim — a second literal would let the card and the
 * real handshake drift apart.
 */
/**
 * `resources` joined tools/prompts on 2026-08-27 for MCP Apps (SEP-1865): a view is served as a
 * `ui://` RESOURCE, so a server that advertises no resources capability can never hand one over,
 * however correct its tool `_meta` is. The surface is read-only and static — see registerUiResources.
 */
const SERVER_CAPABILITIES = { tools: {}, prompts: {}, resources: {} } as const;

/** JSON-RPC error codes returned before a request reaches the MCP server. */
/** Explicit cap on a request body. Equal to express.json()'s own default — see where it is used. */
const MAX_REQUEST_BODY = "100kb";
const JSON_RPC_UNAUTHORIZED = -32001;
const JSON_RPC_METHOD_NOT_ALLOWED = -32000;
const JSON_RPC_RATE_LIMITED = -32002;
const JSON_RPC_INTERNAL_ERROR = -32603;
/** JSON-RPC 2.0's own code for a body that is not valid JSON. */
const JSON_RPC_PARSE_ERROR = -32700;
/** JSON-RPC 2.0's code for a request that is well-formed JSON but not a valid Request object. */
const JSON_RPC_INVALID_REQUEST = -32600;

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
   * Per-IP throttle for the PUBLIC `/status` endpoint, on its OWN accounting store —
   * deliberately not `ipThrottle` above, so polling `/status` can never spend the flood
   * budget that protects the MCP routes (the same separation the capability card keeps).
   * Optional like the rest: DB-free unit tests omit it and `/status` answers ungated.
   */
  readonly statusThrottle?: RateLimiter;
  /**
   * Backlog reader for the `/status` operator signal: the count of `queued`+`running`
   * jobs. Optional and injected exactly like ipThrottle above — the production root wires
   * the DB-backed countPendingJobs; DB-free unit tests omit it, in which case `/status`
   * reports pendingJobs:null and no handler touches the database. The `/status` handler
   * reaches it only through the bounded, cancellable, short-TTL cache built in createApp,
   * so a slow/failing read degrades to null instead of hanging or 5xx-ing the endpoint —
   * and an anonymous flood can never multiply into a flood of queries.
   */
  readonly pendingJobs?: PendingJobsReader;
  /**
   * The personal-URL template the PUBLIC capability card advertises. Decision D28 makes this
   * shape env-driven (`MCP_URL_TEMPLATE`, a Fly secret) so it can change with ONE env edit;
   * the production root below resolves it through @pseo/core's mcpUrlTemplate(), the SAME
   * helper the dashboard renders from, so the card and the dashboard cannot advertise
   * different URLs. Optional exactly like the deps above — DB-free unit tests omit it and the
   * card falls back to the compiled-in default, which is what an unset env resolves to anyway.
   */
  readonly mcpUrlTemplate?: string;
  /**
   * Cloud schema readiness probe for the `/status` operator signal (M-13). Optional and
   * injected exactly like pendingJobs above — the production root wires the DB-backed
   * probeSchemaSentinel; DB-free unit tests omit it, in which case `/status` reports
   * `schema.status: "unknown"` and no handler touches the database. Reached only through the
   * bounded, cancellable, long-TTL cache built in createApp, so it can never become a
   * per-request cost (the H-05 lesson) and a failing probe degrades to `unknown` instead of
   * lying `ready`. Purely REPORTING: nothing in this app refuses to serve on `not_ready`.
   */
  readonly schemaReadiness?: SchemaReadinessProbe;
}

/**
 * The `/status` backlog reader. It takes an AbortSignal because the endpoint's deadline
 * must CANCEL the read, not merely stop waiting for it (see readPendingJobsBounded).
 */
export type PendingJobsReader = (signal: AbortSignal) => Promise<number>;

/** The `/status` schema probe. Cancellable for the same reason PendingJobsReader is. */
export type SchemaReadinessProbe = (signal: AbortSignal) => Promise<SchemaProbeResult>;

/**
 * What `/status` publishes about the cloud schema. `unknown` is a first-class answer, not an
 * error case: the probe failed, timed out, or was never wired, and saying so is the only
 * honest option — a gate that reports what it did not measure is worse than no gate.
 */
export type SchemaStatus = SchemaProbeResult | "unknown";

/**
 * The capability `/status` names as the thing it measured, so a reader never has to guess what
 * `ready` covers (signed lesson 7). Derived from the sentinel constant rather than re-typed, so
 * the payload cannot drift from the object actually probed. Safe to disclose on this
 * unauthenticated route: the function is revoked from anon/authenticated in migration 0014, so
 * knowing its name grants nothing.
 */
const SCHEMA_REQUIREMENT = `rpc:${SCHEMA_SENTINEL_RPC}`;

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
    // Per-IP throttle for the PUBLIC /status endpoint, on its OWN store. Capacity/refill:
    // 60 burst at 1/s is the same shape as the per-KEY allowance, far above any real
    // consumer of this route (a monitor polls every 15-60s, a human refreshes by hand) while
    // still capping what one anonymous IP can extract. The cache above is what bounds the
    // DATABASE cost under a flood; this bounds the cheaper HTTP/serialisation cost.
    // maxEntries bounds memory under an IP-rotating flood, exactly as on ipThrottle. A
    // separate instance means separate accounting: /status must never spend the MCP budget.
    statusThrottle: createRateLimiter({ capacity: 60, refillPerSecond: 1, maxEntries: 10_000 }),
    tools: ALL_TOOLS,
    // Backlog count for /status, over the SAME service client. Read-only, non-tenant
    // aggregate (see countPendingJobs). The signal is threaded through so the /status
    // deadline CANCELS the query rather than orphaning it; createApp additionally puts a
    // short-TTL single-flight cache in front, so a flood of anonymous /status hits cannot
    // multiply into a flood of unindexed counts.
    pendingJobs: (signal) => countPendingJobs(client, signal),
    // Cloud schema readiness for /status, over the SAME service client. Read-only and
    // side-effect-free (see probeSchemaSentinel); the signal is threaded through so the
    // /status deadline CANCELS it, and createApp's long-TTL cache — terminal once ready —
    // is what keeps it off the per-request path.
    schemaReadiness: (signal) => probeSchemaSentinel(client, signal),
    // D28: the personal MCP URL shape comes from MCP_URL_TEMPLATE. Read HERE, at the
    // composition root, alongside the other env-backed wiring — buildServerCard itself stays
    // pure and never touches the environment.
    mcpUrlTemplate: mcpUrlTemplate(),
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
  read: PendingJobsReader | undefined,
  timeoutMs: number,
): Promise<number | null> {
  if (!read) return null;
  return runBounded<number | null>(read, timeoutMs, null, "pendingJobs read");
}

/**
 * The one implementation of the bounded, CANCELLABLE, never-throwing read that every `/status`
 * signal is served through. Extracted so the two readers cannot drift: a second hand-rolled
 * copy is exactly how one of them would later lose the abort and quietly become an amplifier
 * again. `degraded` is what a timeout or ANY failure folds to, and `label` names the signal in
 * the abort reason and the warning.
 *
 * The deadline CANCELS the read; it does not merely stop waiting for it. Racing a promise only
 * abandons the ANSWER — the query underneath keeps running, so an anonymous flood of abandoned
 * /status calls still stacks work onto the database the auth lookup, the queue and the ledger
 * all share. Aborting tears the request down.
 *
 * The reader is invoked INSIDE `.then(read)` (not called directly), so a SYNCHRONOUS throw
 * becomes a rejection and folds exactly like an async one. Folding here (via `.catch`, not
 * left to Promise.race) also means a rejection arriving AFTER the timeout already won is
 * handled, never an unhandled rejection (fatal under Node's default policy).
 */
async function runBounded<T>(
  read: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  degraded: T,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`/status ${label} exceeded ${timeoutMs}ms`));
      resolve(degraded);
    }, timeoutMs);
  });
  const settled = Promise.resolve()
    // deferred invocation: a synchronous throw in read becomes a rejection here
    .then(() => read(controller.signal))
    .catch((error: unknown) => {
      console.warn(`/status ${label} failed: ${errorMessage(error)}`);
      return degraded;
    });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Upper bound (ms) on the `/status` schema probe. Same rationale and same value as the backlog
 * read above: `/status` must stay fast even when the database is the unwell thing.
 */
const STATUS_SCHEMA_TIMEOUT_MS = 1_000;

/**
 * Read cloud schema readiness for `/status`, bounded and never-throwing, folding a timeout, a
 * rejection, a synchronous throw and a missing probe alike to `unknown`. `unknown` — never
 * `ready` — is the ONLY safe fold: a green field that reports what it did not measure is worse
 * than no field at all. Exported so the honesty guarantee is unit-testable directly.
 */
export async function readSchemaStatusBounded(
  read: SchemaReadinessProbe | undefined,
  timeoutMs: number,
): Promise<SchemaStatus> {
  if (!read) return "unknown";
  return runBounded<SchemaStatus>(read, timeoutMs, "unknown", "schema readiness probe");
}

/**
 * Short TTL (ms) on the `/status` backlog answer — the load-bearing half of the flood fix:
 * N anonymous requests inside one window cost ONE query instead of N. 5s is chosen against
 * how the endpoint is really consumed (a dashboard or a human refresh, on a 15-60s rhythm),
 * so a real reader never sees the staleness while an attacker's request rate is decoupled
 * from the database's query rate.
 */
const STATUS_PENDING_CACHE_TTL_MS = 5_000;

/** Tuning knobs for the `/status` backlog cache. Omitted values take the production ones. */
export interface PendingJobsCacheOptions {
  readonly timeoutMs?: number;
  readonly ttlMs?: number;
  readonly now?: () => number; // injectable clock in ms (Date.now); tests pin it
}

/**
 * Wrap the backlog reader in a short-TTL, SINGLE-FLIGHT cache: the answer `/status` serves.
 * Two independent multipliers go away — single-flight collapses CONCURRENT hits onto one
 * in-flight read, the TTL collapses SEQUENTIAL ones — bounding the endpoint's database cost
 * at one query per TTL no matter the request rate. That is what turns an unauthenticated
 * route over an unindexed exact count from an amplifier into a fixed cost.
 *
 * The degraded `null` is cached too, deliberately: the amplification is WORST precisely when
 * the database is unwell, so re-issuing a timing-out query per request would kick it while
 * it is down. Reads still go through readPendingJobsBounded, so its guarantees (never hang,
 * never throw, abort on deadline) hold unchanged for each real read.
 */
export function createPendingJobsCache(
  read: PendingJobsReader | undefined,
  options: PendingJobsCacheOptions = {},
): () => Promise<number | null> {
  return createTtlSingleFlight<number | null>(
    (timeoutMs) => readPendingJobsBounded(read, timeoutMs),
    null,
    {
      timeoutMs: options.timeoutMs ?? STATUS_PENDING_TIMEOUT_MS,
      ttlMs: options.ttlMs ?? STATUS_PENDING_CACHE_TTL_MS,
      now: options.now ?? Date.now,
    },
  );
}

/** Resolved knobs for createTtlSingleFlight (each caller supplies its own defaults). */
interface TtlSingleFlightOptions<T> {
  readonly timeoutMs: number;
  readonly ttlMs: number;
  readonly now: () => number;
  /**
   * Optional "this answer can never change again" test. When it holds, the value is kept
   * FOREVER and the reader is never called again — the strongest possible form of the
   * anti-amplification guarantee, available only where the underlying fact is monotonic.
   */
  readonly isTerminal?: (value: T) => boolean;
}

/**
 * The TTL + SINGLE-FLIGHT core both `/status` caches are built from. Single-flight collapses
 * CONCURRENT hits onto one in-flight read, the TTL collapses SEQUENTIAL ones — together they
 * bound the endpoint's database cost at one query per TTL no matter the request rate, which is
 * what keeps an unauthenticated route from being an amplifier. `degraded` is the value a
 * (contractually impossible) rejection folds to.
 */
function createTtlSingleFlight<T>(
  read: (timeoutMs: number) => Promise<T>,
  degraded: T,
  options: TtlSingleFlightOptions<T>,
): () => Promise<T> {
  const { timeoutMs, ttlMs, now, isTerminal } = options;
  let cached: { readonly value: T; readonly atMs: number } | null = null;
  let terminal = false;
  let inFlight: Promise<T> | null = null;
  return () => {
    if (cached !== null && (terminal || now() - cached.atMs < ttlMs)) {
      return Promise.resolve(cached.value);
    }
    if (inFlight !== null) return inFlight; // a read is already out — join it, do not add one
    const settled = read(timeoutMs)
      .then((value) => {
        cached = { value, atMs: now() };
        terminal = isTerminal?.(value) ?? false;
        return value;
      })
      // Non-rejecting by contract; this arm only stops a future change there from wedging
      // the cache with a permanently in-flight read.
      .catch(() => degraded)
      .finally(() => (inFlight = null));
    inFlight = settled;
    return settled;
  };
}

/**
 * TTL (ms) on the `/status` schema answer. A minute, not the backlog's 5s, because the fact
 * moves at HUMAN pace: it changes exactly once, when an operator applies migrations to the
 * cloud project. One probe per minute per process is a rounding error next to any real load,
 * and the endpoint still converges within a minute of the migration landing — no redeploy.
 */
const STATUS_SCHEMA_CACHE_TTL_MS = 60_000;

/**
 * The `/status` schema answer, bounded exactly like the backlog one and with one extra rule:
 * `ready` is TERMINAL. Migrations are forward-only, so a schema that has once satisfied this
 * build cannot stop satisfying it while the process lives — after the first successful probe
 * the endpoint costs ZERO further database work for the rest of the process's lifetime.
 * `not_ready` and `unknown` keep re-probing on the TTL, which is what lets the field converge
 * on its own once a human applies the pending migrations.
 */
export function createSchemaStatusCache(
  read: SchemaReadinessProbe | undefined,
  options: PendingJobsCacheOptions = {},
): () => Promise<SchemaStatus> {
  return createTtlSingleFlight<SchemaStatus>(
    (timeoutMs) => readSchemaStatusBounded(read, timeoutMs),
    "unknown",
    {
      timeoutMs: options.timeoutMs ?? STATUS_SCHEMA_TIMEOUT_MS,
      ttlMs: options.ttlMs ?? STATUS_SCHEMA_CACHE_TTL_MS,
      now: options.now ?? Date.now,
      isTerminal: (value) => value === "ready",
    },
  );
}

/**
 * Baseline security headers, set on EVERY response this gateway emits. This is a public,
 * internet-facing HTTP surface whose most-fetched routes (the capability card, `/status`,
 * the 401/405 rejections) are unauthenticated, so the hardening belongs at the app level
 * rather than per-route — a route added later inherits it by construction.
 *
 *   X-Content-Type-Options    — every response here is JSON; nosniff stops a browser from
 *                               re-interpreting an error body as HTML/script.
 *   Referrer-Policy           — the PERSONAL endpoint carries the API key in the URL PATH,
 *                               so a referrer header leaving this origin would carry the
 *                               credential with it. no-referrer is the only safe value.
 *   X-Frame-Options / CSP     — nothing here is meant to be framed; both are sent because
 *     frame-ancestors            X-Frame-Options is what older browsers honour and
 *                               frame-ancestors is what current ones do.
 *
 * Headers only: no status code, body or route behaviour changes — `/healthz` in particular
 * answers exactly as before (it is the live uptime probe).
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

/**
 * Return `rawKey` when it has the sg_ format, or send a 401 JSON-RPC error and
 * return null. The caller supplies the raw candidate (a path param or a header
 * value), both `string | undefined`, so a MISSING key fails this same gate — the
 * header form's "no header at all" is therefore byte-identical to the path form's
 * missing key. 401 (never 403): a 403 reads as an initialization failure to the
 * directory scanners that probe this endpoint. The sg_ shape is public (not a
 * secret), so a distinct "format" message here is not an info leak; unknown vs
 * revoked, which ARE sensitive, share one message downstream.
 */
function keyOrReject(rawKey: string | undefined, res: Response): string | null {
  if (typeof rawKey !== "string" || !hasValidKeyFormat(rawKey)) {
    res.status(401).json(jsonRpcError(JSON_RPC_UNAUTHORIZED, "Invalid API key format"));
    return null;
  }
  return rawKey;
}

/** Header carrying the personal key on the FIXED endpoint; preferred over `authorization`. */
const API_KEY_HEADER = "x-api-key";
/** Fallback credential header on the fixed endpoint, in `Bearer <key>` form. */
const AUTHORIZATION_HEADER = "authorization";
/** Matches a Bearer scheme case-insensitively (`Bearer`/`bearer`) and captures the token. */
const BEARER_PATTERN = /^bearer[ \t]+(\S.*)$/i;

/** First value of a possibly-repeated header, or undefined when absent. */
function firstHeaderValue(value: string | readonly string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : (value as string | undefined);
}

/**
 * Extract the personal key from the request HEADERS for the FIXED `/mcp` endpoint.
 * Precedence: `x-api-key` first, then `authorization: Bearer <key>`. x-api-key WINS
 * when both are present because it is the unambiguous, purpose-built carrier — the
 * proxies and directories this endpoint exists for pass user config that way, whereas
 * `authorization` is also what a generic OAuth layer would populate, so preferring it
 * would let an unrelated token shadow the key the user actually configured. An EMPTY
 * value counts as absent (fall through, then fail the format gate) — a client that
 * sets a blank header should get the same answer as one that sets none.
 * Returns undefined when neither header carries a value; the format gate rejects that.
 */
function keyFromHeaders(req: Request): string | undefined {
  const direct = firstHeaderValue(req.headers[API_KEY_HEADER]);
  if (direct !== undefined && direct !== "") return direct;
  const authorization = firstHeaderValue(req.headers[AUTHORIZATION_HEADER]);
  return authorization === undefined ? undefined : (BEARER_PATTERN.exec(authorization)?.[1]);
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
 * The MCP Apps view surface (SEP-1865): `resources/list` and `resources/read` over UI_RESOURCES.
 *
 * TENANT-INDEPENDENT, exactly like `registerPrompts` beside it — a view is a static template, the
 * same bytes for every caller, and the DATA that fills it travels with the tool result. That is
 * also why nothing here reads `ctx`: a resource handler that touched tenant data would be a
 * second, unaudited path to it, and this one has no reason to exist.
 *
 * An unknown URI is refused rather than answered with an empty list, so a host that asks for a
 * view this deploy does not serve learns that instead of rendering a blank frame.
 */
function registerUiResources(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: UI_RESOURCES.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: MCP_APP_MIME,
    })),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const resource = UI_RESOURCES.find((candidate) => candidate.uri === request.params.uri);
    if (!resource) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    return {
      contents: [{ uri: resource.uri, mimeType: MCP_APP_MIME, text: resource.html }],
    };
  });
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
  const server = new Server(SERVER_INFO, { capabilities: SERVER_CAPABILITIES });
  registerAll(server, { ctx, tools });
  registerPrompts(server);
  registerUiResources(server);
  return server;
}

/**
 * Media types the SDK's Streamable HTTP POST path demands a client accept. It tests for
 * BOTH as plain SUBSTRINGS of the Accept header, so a wildcard alone does not satisfy it.
 */
const REQUIRED_ACCEPT_TYPES = ["application/json", "text/event-stream"] as const;

/** Accept media ranges that mean "this client will take JSON" — exact, or a wildcard over it. */
const JSON_ACCEPT_RANGES: readonly string[] = ["application/json", "application/*", "*/*"];

/** The media range of one Accept entry: the part before any `;q=` parameters, lowercased. */
function mediaRangeOf(entry: string): string {
  const [range] = entry.split(";");
  return (range ?? "").trim().toLowerCase();
}

/**
 * The Accept value to hand the MCP transport, or undefined meaning "leave the client's
 * header alone".
 *
 * WHY this is safe: the transport below is built with `enableJsonResponse: true` and this
 * gateway never initiates a stream, so EVERY response is plain JSON. The SDK's "client must
 * accept text/event-stream" rule on POST is therefore vestigial for this server — refusing a
 * JSON-only client buys us nothing and broke real consumers (a directory scanner connected
 * but read back serverInfo:null, which is exactly the 406 this produced). This widens what we
 * ACCEPT; it never changes what we EMIT.
 *
 * Only a client that already signalled it takes JSON is widened — explicitly, via a wildcard
 * media range, or by sending no Accept at all (HTTP treats an absent Accept as the full
 * wildcard). Its own media types are KEPT and only the missing required ones are appended, so
 * an Accept that genuinely excludes JSON (e.g. `text/html`) yields undefined and the SDK's
 * content negotiation still answers 406 exactly as before.
 */
export function negotiatedAccept(raw: string | undefined): string | undefined {
  const offered = raw ?? "*/*"; // an absent Accept means "any media type" per HTTP
  const acceptsJson = offered
    .split(",")
    .some((entry) => JSON_ACCEPT_RANGES.includes(mediaRangeOf(entry)));
  if (!acceptsJson) return undefined;
  const missing = REQUIRED_ACCEPT_TYPES.filter((type) => !offered.includes(type));
  return missing.length === 0 ? offered : [offered, ...missing].join(", ");
}

/** Header name matched case-insensitively while rewriting the flat rawHeaders array. */
const ACCEPT_HEADER = "accept";

/**
 * A NEW rawHeaders array (the input is never mutated) carrying exactly one `Accept` entry,
 * set to `value`. Required in ADDITION to the parsed `headers` object because the SDK's
 * transport converts the Node request to a Web Request via @hono/node-server, which reads
 * `rawHeaders` — so widening only `headers.accept` would be invisible to it. Node stores
 * rawHeaders FLAT as [name0, value0, name1, value1, ...]; each entry is kept or dropped by
 * the NAME slot (its own, at an even index; the preceding one, at an odd index), so a
 * dropped Accept takes its value with it and every other header survives untouched.
 */
function withAcceptHeader(rawHeaders: readonly string[], value: string): string[] {
  const withoutAccept = rawHeaders.filter((entry, index) =>
    index % 2 === 0
      ? entry.toLowerCase() !== ACCEPT_HEADER
      : (rawHeaders[index - 1] ?? "").toLowerCase() !== ACCEPT_HEADER,
  );
  return [...withoutAccept, "Accept", value];
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
    // Widen the Accept the transport sees (see negotiatedAccept for why that is safe here).
    // Assignment on the request is how the value reaches the SDK: it reads Accept off the Node
    // request, not from an argument — `headers` for the Express-side view and `rawHeaders`,
    // which is what the SDK's Node->Web Request conversion actually parses. Undefined means the
    // client did not offer JSON, so its header — and the SDK's 406 — are left untouched.
    const accept = negotiatedAccept(req.headers.accept);
    if (accept !== undefined) {
      req.headers.accept = accept;
      req.rawHeaders = withAcceptHeader(req.rawHeaders, accept);
    }
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
 * Build the MCP gateway HTTP app: a health probe plus the MCP endpoint, exposed in TWO
 * equivalent forms — the personal URL `/mcp/:key` (key in the path) and the fixed `/mcp`
 * (key in a header). They share one handler and one throttle store; only key EXTRACTION
 * differs. `deps` (authenticate, the per-IP ipThrottle, and tools) are injected; the default
 * wires the real DB-backed collaborators, while tests pass fakes to run without a DB.
 */
export function createApp(deps: AppDeps = buildDefaultDeps()): Express {
  const app = express();
  // Do not advertise the framework: `X-Powered-By: Express` tells a scanner which stack
  // (and therefore which CVE list) to aim at, and buys a client nothing.
  app.disable("x-powered-by");
  // Baseline hardening on every response, mounted BEFORE any route so no surface can be
  // added past it (see SECURITY_HEADERS for the per-header rationale).
  app.use((_req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });
  // The body limit, STATED. 100kb is exactly what express.json() already defaulted to, so this
  // changes no behaviour — it makes the contract readable in the code instead of living in a
  // framework default nobody can see (L-03, audit 2026-08-26). The largest legitimate request this
  // server takes is a tool call with a bounded array (ten compare targets, ten SERP keywords), which
  // is orders of magnitude below it.
  app.use(express.json({ limit: MAX_REQUEST_BODY }));

  // Liveness probe for Fly health checks and load balancers.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Public MCP capability card — the answer to an auth-walled server being unscannable (see
  // server-card.ts for why it exists and what it may disclose). It holds itself to /healthz's
  // discipline: unauthenticated, ZERO database reads, and no throttle accounting. The payload
  // is built ONCE here because the registry is static, so the handler does no work at all —
  // it cannot be slow, cannot fail, and has nothing per-request to leak. Its path lives under
  // /.well-known/, which cannot collide with `/mcp` or `/mcp/:key`, so the MCP auth chain
  // (format gate -> per-IP throttle -> authenticate) is untouched and a scanner polling the
  // card can never spend the flood budget that protects the real endpoints.
  const serverCard = buildServerCard({
    serverInfo: SERVER_INFO,
    capabilities: SERVER_CAPABILITIES,
    tools: deps.tools ?? [],
    mcpUrlTemplate: deps.mcpUrlTemplate ?? DEFAULT_MCP_URL_TEMPLATE,
  });
  app.get(SERVER_CARD_PATH, (_req, res) => {
    res
      .set("Cache-Control", SERVER_CARD_CACHE_CONTROL)
      // The card is a credential-free public document and the well-known discovery convention
      // expects it to be readable cross-origin, so browser-based validators and directory
      // tooling can fetch it. Nothing here is tenant-scoped, so `*` gives away nothing.
      .set("Access-Control-Allow-Origin", "*")
      .json(serverCard);
  });

  // Operator status signal — deliberately SEPARATE from /healthz. /healthz stays a trivial
  // zero-I/O liveness probe wired to the Fly health check (fly.toml, every 15s / 2s timeout)
  // AND the external uptime monitor; adding a DB read there would let a slow DB fail the
  // check and have Fly kill an otherwise-healthy machine. /status carries the richer signals
  // and is NOT wired to any health check, so its DB read can never endanger liveness.
  // Unauthenticated on purpose: it exposes only COARSE, PROCESS-WIDE operational counts
  // (uptime, 5xx-since-boot, and the global queued+running backlog) — no tenant data and
  // nothing per-user — so it is as safe to DISCLOSE as /healthz. Being anonymous, though, it
  // must also be cheap to ABUSE — a separate property, and the one it lacked: N anonymous
  // hits became N unindexed exact counts on the database auth, the queue and the ledger
  // share. Three gates now stand in front, cheapest first: a per-IP throttle on its own
  // budget (in-memory, zero I/O), then a short-TTL single-flight cache (N requests -> at
  // most one query per TTL), and only then the bounded, CANCELLABLE read. Best-effort
  // contract unchanged: on a slow or broken DB it degrades to null and STILL answers ok.
  const readCachedPendingJobs = createPendingJobsCache(deps.pendingJobs);
  // Cloud schema readiness (M-13), behind the SAME three gates as the backlog above. This is a
  // REPORT, never a gate: the cloud schema is genuinely allowed to lag the shipped code, so a
  // refuse-to-serve rule here would black out production the moment it deployed. Nothing else
  // in this app reads the answer — it exists so an operator (and a deploy runbook) can SEE the
  // lag instead of discovering it as a runtime error inside a paid tool call.
  const readCachedSchemaStatus = createSchemaStatusCache(deps.schemaReadiness);
  app.get("/status", async (req, res) => {
    // Throttle FIRST: a denied /status costs one in-memory token check and nothing else.
    if (deps.statusThrottle && !deps.statusThrottle.tryConsume(clientIpOf(req))) {
      res.status(429).json({ ok: false, error: "Rate limit exceeded" });
      return;
    }
    // Both signals are already individually bounded, so reading them CONCURRENTLY keeps the
    // endpoint's worst-case latency at one bound rather than the sum of two.
    const [pendingJobs, schemaStatus] = await Promise.all([
      readCachedPendingJobs(),
      readCachedSchemaStatus(),
    ]);
    // Fields are picked EXPLICITLY, not spread from metrics.snapshot() (L-02). The snapshot
    // also carries the reaper counters, and those are recorded in the WORKER process — which
    // runs no HTTP listener — while /status is answered by the WEB process, whose counters
    // never see a sweep. Spread in, they were structurally 0/0/null forever: three fields
    // that read as measurements and measured nothing. An explicit pick is what keeps a future
    // counter from silently acquiring the same shape; the reaper's real heartbeat is the
    // worker's per-sweep log (scripts/monitoring.md §4).
    const { uptimeSeconds, errorsSinceBoot } = metrics.snapshot();
    // `requires` ships WITH the status for the same L-02 reason the reaper fields were removed:
    // a bare "ready" is a claim, and a claim that does not say what it measured is the shape of
    // a green gate that measured nothing.
    res.json({
      ok: true,
      uptimeSeconds,
      errorsSinceBoot,
      pendingJobs,
      schema: { status: schemaStatus, requires: SCHEMA_REQUIREMENT },
    });
  });

  // The MCP POST pipeline, shared VERBATIM by both endpoints below. The ONLY
  // difference between the personal-URL form and the fixed header form is how the
  // raw key was extracted (`rawKey`); everything from the format gate onward lives
  // here exactly once, so the two routes cannot drift apart — a security fix or a
  // gate reordering applies to both by construction.
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
  const handleMcpPost = async (
    req: Request,
    res: Response,
    rawKey: string | undefined,
  ): Promise<void> => {
    const key = keyOrReject(rawKey, res);
    if (key === null) return;

    // Per-IP flood throttle BEFORE authenticate: a well-formed-but-invalid key still
    // costs one api_keys read inside authenticate, so an unauthenticated flood is
    // capped here by client IP first. A denied request answers the SAME 429 envelope
    // as the per-key limiter (indistinguishable) and performs ZERO DB reads. Skipped
    // when no throttle is injected (DB-free unit tests). Because BOTH routes reach
    // this one line, they consume from the SAME deps.ipThrottle accounting store:
    // an attacker cannot win a fresh budget by switching from the path form to the
    // header form (pinned by the shared-throttle specs).
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
  };

  // Personal MCP endpoint — Streamable HTTP, stateless. POST carries JSON-RPC.
  // The key is a PATH segment here: this is the personal-URL form the dashboard
  // renders (MCP_URL_TEMPLATE) and the shape the MCP registry's {key} URL template
  // expresses. Unchanged.
  app.post("/mcp/:key", (req, res) => handleMcpPost(req, res, req.params.key));

  // FIXED MCP endpoint — same handler, same pipeline, key read from a HEADER instead.
  // Required by proxies and directories that forward to ONE fixed upstream URL and can
  // only pass user config as a header, and preferred on security grounds: a header keeps
  // the credential out of URLs, which land in logs, proxies and browser history. Kept
  // ALONGSIDE the path form (not replacing it) because some clients cannot send custom
  // headers, so the personal URL stays the default everywhere.
  app.post("/mcp", (req, res) => handleMcpPost(req, res, keyFromHeaders(req)));

  // GET (SSE) and DELETE (session end) are unsupported in stateless mode; reject
  // after the same key-format gate so clients get a consistent 401 on bad keys.
  // These transport methods carry no request body to dispatch, so they stop at the
  // format gate and never perform key authentication. Both key carriers are wired so
  // a probe of the fixed endpoint gets the same JSON-RPC 405 as the path form rather
  // than Express's default HTML 404.
  const rejectNonPost =
    (extractKey: (req: Request) => string | undefined) =>
    (req: Request, res: Response): void => {
      if (keyOrReject(extractKey(req), res) === null) return;
      res
        .status(405)
        .json(jsonRpcError(JSON_RPC_METHOD_NOT_ALLOWED, "Method not allowed in stateless mode"));
    };
  const rejectNonPostFromPath = rejectNonPost((req) => req.params.key);
  const rejectNonPostFromHeaders = rejectNonPost(keyFromHeaders);
  app.get("/mcp/:key", rejectNonPostFromPath);
  app.delete("/mcp/:key", rejectNonPostFromPath);
  app.get("/mcp", rejectNonPostFromHeaders);
  app.delete("/mcp", rejectNonPostFromHeaders);

  // ---- The two remaining HTML surfaces -------------------------------------------------------
  //
  // Everything above answers in JSON-RPC; everything NOT above fell through to Express's built-in
  // handlers, which serve `<!DOCTYPE html>… <pre>Cannot GET /x</pre>`. MEASURED against production
  // on 2026-08-27: an unknown path returned 404 text/html, and a malformed body 400 text/html
  // (L-03). No stack, env or secret leaked — that was checked, and it is why this is a
  // consistency fix rather than a disclosure one. But an MCP client is a JSON-RPC client: handed
  // HTML it reports a parse failure instead of the server's actual answer, and the operator
  // debugging it starts from the wrong error.
  //
  // ORDER MATTERS AND IS LOAD-BEARING. The 404 is registered after every route so it catches only
  // what nothing else claimed; the error handler is registered LAST and takes four arguments,
  // which is the only way Express recognises it as an error handler at all.

  app.use((_req, res) => {
    res.status(404).json(jsonRpcError(JSON_RPC_METHOD_NOT_ALLOWED, "No such endpoint"));
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    // A response already on the wire cannot be rewritten; hand it to Express to close out.
    if (res.headersSent) {
      next(error);
      return;
    }
    // body-parser tags its own failures with `type`, which separates "not JSON" (-32700) from
    // "too big" from anything else. The MESSAGE is ours in every branch: body-parser's own text
    // can quote the offending input back, and echoing a request body into a response is how an
    // error surface starts leaking what was sent to it.
    const type = (error as { type?: string } | null)?.type;
    if (type === "entity.parse.failed") {
      res.status(400).json(jsonRpcError(JSON_RPC_PARSE_ERROR, "Parse error: body is not valid JSON"));
      return;
    }
    if (type === "entity.too.large") {
      res
        .status(413)
        .json(jsonRpcError(JSON_RPC_INVALID_REQUEST, `Request body exceeds the ${MAX_REQUEST_BODY} limit`));
      return;
    }
    console.error("mcp: unhandled request error:", errorMessage(error));
    res.status(500).json(jsonRpcError(JSON_RPC_INTERNAL_ERROR, "Internal server error"));
  });

  return app;
}
