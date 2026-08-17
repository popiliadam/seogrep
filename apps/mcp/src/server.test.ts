import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import http from "node:http";
import { unlinkSync } from "node:fs";
import { createApp, type AppDeps } from "./server.ts";
// Additive T5 import kept on its own line so every existing line above stays byte-identical.
import { readPendingJobsBounded } from "./server.ts";
import { safeKeyPrefix, type AuthContext, type AuthDecision } from "./auth.ts";
// Additive imports for the fixed header-key endpoint specs, each on its own line so
// every existing line above stays byte-identical: the production tool set (to prove
// both routes advertise the same 24 tools) and a REAL limiter (to prove one shared budget).
import { createRateLimiter } from "./auth.ts";
import { ALL_TOOLS } from "./tools/index.ts";
// Additive import for the JSON-only Accept specs, on its own line so every existing
// line above stays byte-identical.
import { negotiatedAccept } from "./server.ts";
// Additive H-05 imports, each on its own line for the same reason: the /status backlog
// cache, and the DB-side reader whose cancellation wiring it depends on.
import { createPendingJobsCache } from "./server.ts";
import { countPendingJobs } from "./db.ts";
// Additive M-13 imports (cloud schema readiness), each on its own line for the same reason:
// the bounded reader and the cache that keeps the probe off the per-request path.
import { createSchemaStatusCache, readSchemaStatusBounded } from "./server.ts";

// server.test.ts evolves the T1 format-gate suite into the real auth contract: the
// app is exercised through an INJECTED authenticate (no DB) that yields typed
// decisions, so the "valid key -> dispatch" cases now require a resolved tenant
// context, and three new surfaces are asserted — 401 for a well-formed-but-unknown
// key, 429 for a rate_limited decision, and 500 (process survives) when the auth
// pipeline rejects. The pure hasValidKeyFormat unit cases moved with the function
// to auth.test.ts; the limiter's lookup->limit->stamp ordering (429 = zero writes)
// is pinned in auth.test.ts. No prior assertion was weakened.

const VALID_KEY = "sg_testkey1234";
const CONTEXT: AuthContext = { userId: "user-A", keyId: "key-1" };
const OK_DECISION: AuthDecision = { status: "ok", context: CONTEXT };
const UNAUTHORIZED: AuthDecision = { status: "unauthorized" };

/** Build the app with fake, DB-free deps. Overrides let a test force a path. */
function appWith(overrides: Partial<AppDeps> = {}): ReturnType<typeof createApp> {
  const deps: AppDeps = {
    authenticate: (key) => Promise.resolve(key === VALID_KEY ? OK_DECISION : UNAUTHORIZED),
    ...overrides,
  };
  return createApp(deps);
}

interface Listening {
  readonly baseUrl: string;
  close(): Promise<void>;
}

async function listen(app: ReturnType<typeof createApp>): Promise<Listening> {
  const server: HttpServer = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

const postRpc = (baseUrl: string, key: string, body: unknown): Promise<Response> =>
  fetch(`${baseUrl}/mcp/${key}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });

/** POST with extra request headers (e.g. Fly-Client-IP) merged over the JSON-RPC defaults. */
const postRpcWith = (
  baseUrl: string,
  key: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> =>
  fetch(`${baseUrl}/mcp/${key}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("mcp gateway app", () => {
  let app: Listening;

  beforeAll(async () => {
    app = await listen(appWith());
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /healthz returns { ok: true }", async () => {
    const res = await fetch(`${app.baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST /mcp/:key with a malformed key returns 401 JSON-RPC error", async () => {
    const res = await postRpc(app.baseUrl, "not-a-key", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe(-32001);
    expect(body.jsonrpc).toBe("2.0");
  });

  it("POST /mcp/:key with a well-formed but UNKNOWN key returns 401 (past the format gate)", async () => {
    const res = await postRpc(app.baseUrl, "sg_unknownkey99", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe(-32001);
  });

  it.each(["GET", "DELETE"])("%s /mcp/:key is 405 for a valid key format", async (method) => {
    const res = await fetch(`${app.baseUrl}/mcp/${VALID_KEY}`, { method });
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe(-32000);
  });

  it("POST initialize (authenticated) returns the seogrep-mcp server info", async () => {
    const res = await postRpc(app.baseUrl, VALID_KEY, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0.0.0" },
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("seogrep-mcp");
  });

  it("POST tools/list (authenticated) returns an empty tool list", async () => {
    const res = await postRpc(app.baseUrl, VALID_KEY, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools).toEqual([]);
  });
});

describe("mcp gateway prompts", () => {
  // Prompts are STATIC (no tenant/DB), so they are advertised even when no tools are injected —
  // the same DB-free app the other gateway specs use. This is the inspector-equivalent proof that
  // prompts/list returns every orchestration prompt and prompts/get renders one.
  it("POST prompts/list returns the orchestration prompts in order", async () => {
    const app = await listen(appWith());
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, {
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/list",
        params: {},
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.prompts.map((prompt: { name: string }) => prompt.name)).toEqual([
        "new-site-audit",
        "monthly-routine",
        "quick-wins-sprint",
        "gsc-health-check",
      ]);
    } finally {
      await app.close();
    }
  });

  it("POST prompts/get renders a prompt with its argument interpolated", async () => {
    const app = await listen(appWith());
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, {
        jsonrpc: "2.0",
        id: 2,
        method: "prompts/get",
        params: { name: "monthly-routine", arguments: { project_id: "proj-xyz" } },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.messages[0].role).toBe("user");
      expect(body.result.messages[0].content.text).toContain("proj-xyz");
      expect(body.result.messages[0].content.text).toContain("pull_gsc_data");
    } finally {
      await app.close();
    }
  });
});

describe("mcp gateway auth failure handling", () => {
  it("returns 500 JSON-RPC error when authenticate rejects, keeps serving, never logs the key", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = await listen(
      appWith({ authenticate: () => Promise.reject(new Error("db down")) }),
    );
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe(-32603);
      expect(body.jsonrpc).toBe("2.0");

      // The process survives the rejection and keeps serving (no crash-loop).
      const after = await fetch(`${app.baseUrl}/healthz`);
      expect(after.status).toBe(200);

      // The plaintext key is never logged — at most its safe prefix.
      const logged = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(logged).toContain(safeKeyPrefix(VALID_KEY));
      expect(logged).not.toContain(VALID_KEY);
    } finally {
      errorSpy.mockRestore();
      await app.close();
    }
  });
});

describe("mcp gateway rate limiting", () => {
  it("returns 429 JSON-RPC error when the auth decision is rate_limited", async () => {
    const app = await listen(
      appWith({ authenticate: () => Promise.resolve({ status: "rate_limited" }) }),
    );
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe(-32002);
      expect(body.jsonrpc).toBe("2.0");
    } finally {
      await app.close();
    }
  });
});

describe("mcp gateway per-IP flood throttle", () => {
  it("throttled IP: 429 and authenticate is NEVER called (the 429 path performs zero DB reads)", async () => {
    const authenticate = vi.fn(() => Promise.resolve(OK_DECISION));
    const app = await listen(appWith({ authenticate, ipThrottle: { tryConsume: () => false } }));
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error.code).toBe(-32002); // same envelope as the per-key 429 (indistinguishable)
      expect(body.jsonrpc).toBe("2.0");
      // authenticate is where the DB lookup lives; a throttled request must not reach it.
      expect(authenticate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("allowing throttle: the request reaches authenticate exactly once (flow intact)", async () => {
    const authenticate = vi.fn((key: string) =>
      Promise.resolve(key === VALID_KEY ? OK_DECISION : UNAUTHORIZED),
    );
    const app = await listen(appWith({ authenticate, ipThrottle: { tryConsume: () => true } }));
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(res.status).toBe(200);
      expect(authenticate).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("malformed key: 401 format path and the throttle is NOT consumed (format gate runs first)", async () => {
    const tryConsume = vi.fn(() => true);
    const app = await listen(appWith({ ipThrottle: { tryConsume } }));
    try {
      const res = await postRpc(app.baseUrl, "not-a-key", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe(-32001);
      expect(tryConsume).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("no throttle injected (undefined): requests flow as before (back-compat)", async () => {
    const authenticate = vi.fn((key: string) =>
      Promise.resolve(key === VALID_KEY ? OK_DECISION : UNAUTHORIZED),
    );
    const app = await listen(appWith({ authenticate })); // ipThrottle omitted
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(res.status).toBe(200);
      expect(authenticate).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});

describe("mcp gateway /status endpoint", () => {
  // /status is the operator signal, SEPARATE from /healthz (which stays a trivial zero-I/O
  // liveness probe wired to the Fly check). It is unauthenticated and exposes only coarse
  // process-wide counts. The pending-jobs backlog is injected as a fake here (the fast lane
  // is DB-free) exactly the way ipThrottle/authenticate are, so no DB is touched.

  it("GET /status returns ok:true with numeric counters and the injected pendingJobs", async () => {
    const app = await listen(appWith({ pendingJobs: () => Promise.resolve(3) }));
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.pendingJobs).toBe(3);
      expect(typeof body.uptimeSeconds).toBe("number");
      expect(typeof body.errorsSinceBoot).toBe("number");
    } finally {
      await app.close();
    }
  });

  it("GET /status degrades to pendingJobs:null (still ok:true) when the backlog read REJECTS", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = await listen(
      appWith({ pendingJobs: () => Promise.reject(new Error("db down")) }),
    );
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200); // never 5xx — /status is a signal, not a liveness gate
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.pendingJobs).toBeNull();
    } finally {
      warnSpy.mockRestore();
      await app.close();
    }
  });

  it("GET /status degrades to pendingJobs:null (still ok:true) when the backlog read THROWS SYNCHRONOUSLY", async () => {
    // The charter is "never hang or 5xx no matter what the reader does" — a synchronous
    // throw (not a rejecting promise) must fold to null exactly like a rejection, or the
    // async handler would reject with no catch and Express 4 would hang the response.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = await listen(
      appWith({
        pendingJobs: () => {
          throw new Error("sync boom");
        },
      }),
    );
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.pendingJobs).toBeNull();
    } finally {
      warnSpy.mockRestore();
      await app.close();
    }
  });

  it("GET /status returns pendingJobs:null when no backlog reader is injected (DB-free default)", async () => {
    const app = await listen(appWith()); // no pendingJobs dep — mirrors the DB-free unit path
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.pendingJobs).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("GET /status carries ONLY fields this process can actually measure (L-02)", async () => {
    // The reaper runs in the WORKER process, which starts no HTTP listener; /status is
    // answered by the WEB process, whose metrics singleton NEVER sees a sweep. So
    // reaperRuns/reservesReleased/lastReaperRunAt were structurally 0/0/null here — three
    // fields that looked like measurements and were not. They are gone from the response;
    // the reaper's real heartbeat is the worker's per-sweep log (scripts/monitoring.md §4).
    //
    // Pinned as an EXACT key set rather than per-field type checks: that is the only shape
    // assertion a future `...metrics.snapshot()` spread cannot silently slip a new
    // unmeasurable field past.
    const app = await listen(appWith({ pendingJobs: () => Promise.resolve(0) }));
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual([
        "errorsSinceBoot",
        "ok",
        "pendingJobs",
        "schema",
        "uptimeSeconds",
      ]);
      expect(typeof body.uptimeSeconds).toBe("number");
      expect(typeof body.errorsSinceBoot).toBe("number");
    } finally {
      await app.close();
    }
  });

  it("a request that hits the 500 path increments errorsSinceBoot seen on a later /status", async () => {
    // metrics is a process singleton shared by every app in this file, so assert the DELTA
    // (before -> after) rather than an absolute count: robust to any 5xx another test logged.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = await listen(appWith({ authenticate: () => Promise.reject(new Error("db down")) }));
    try {
      const before = await (await fetch(`${app.baseUrl}/status`)).json();
      const res = await postRpc(app.baseUrl, VALID_KEY, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(res.status).toBe(500);
      const after = await (await fetch(`${app.baseUrl}/status`)).json();
      expect(after.errorsSinceBoot).toBe(before.errorsSinceBoot + 1);
    } finally {
      errorSpy.mockRestore();
      await app.close();
    }
  });
});

describe("readPendingJobsBounded (bounded best-effort backlog read)", () => {
  // The unit-level proof of the /status degradation contract: a slow read must resolve to
  // null within the bound (NEVER hang), a rejection must resolve to null, and a missing
  // reader must resolve to null — so /status can always answer without the DB deciding it.

  it("returns the count when the read resolves within the bound", async () => {
    expect(await readPendingJobsBounded(() => Promise.resolve(7), 1_000)).toBe(7);
  });

  it("resolves null (never hangs) when the read exceeds the timeout", async () => {
    const hang = () => new Promise<number>(() => undefined); // never settles
    const start = Date.now();
    const result = await readPendingJobsBounded(hang, 20);
    expect(result).toBeNull();
    expect(Date.now() - start).toBeLessThan(1_000); // bounded, did not wait on the hung read
  });

  it("resolves null and warns when the read rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await readPendingJobsBounded(() => Promise.reject(new Error("boom")), 1_000);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("resolves null when no reader is wired", async () => {
    expect(await readPendingJobsBounded(undefined, 1_000)).toBeNull();
  });
});

describe("mcp gateway client IP extraction (throttle bucket key)", () => {
  // clientIpOf is module-private; it is exercised through driven requests by injecting a
  // throttle that records the id (bucket key) it was consulted with.
  it("prefers the Fly-Client-IP header over the socket peer address", async () => {
    let seenIp: string | undefined;
    const app = await listen(
      appWith({ ipThrottle: { tryConsume: (id) => {
          seenIp = id;
          return true;
        } } }),
    );
    try {
      await postRpcWith(
        app.baseUrl,
        VALID_KEY,
        { "fly-client-ip": "203.0.113.7" },
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
      );
      expect(seenIp).toBe("203.0.113.7"); // the header, not the 127.0.0.1 socket peer
    } finally {
      await app.close();
    }
  });

  it("normalizes an IPv4-mapped IPv6 Fly-Client-IP to its bare IPv4 form", async () => {
    let seenIp: string | undefined;
    const app = await listen(
      appWith({ ipThrottle: { tryConsume: (id) => {
          seenIp = id;
          return true;
        } } }),
    );
    try {
      await postRpcWith(
        app.baseUrl,
        VALID_KEY,
        { "fly-client-ip": "::ffff:203.0.113.9" },
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
      );
      expect(seenIp).toBe("203.0.113.9");
    } finally {
      await app.close();
    }
  });

  it("falls back to the socket peer address when Fly-Client-IP is absent", async () => {
    let seenIp: string | undefined;
    const app = await listen(
      appWith({ ipThrottle: { tryConsume: (id) => {
          seenIp = id;
          return true;
        } } }),
    );
    try {
      // baseUrl connects over IPv4 loopback, so the peer normalizes to 127.0.0.1
      // (whether the dual-stack socket reports it bare or IPv4-mapped).
      await postRpc(app.baseUrl, VALID_KEY, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(seenIp).toBe("127.0.0.1");
    } finally {
      await app.close();
    }
  });

  it("yields 'unknown' when neither Fly-Client-IP nor a socket peer address is present", async () => {
    let seenIp: string | undefined;
    // A Unix-domain-socket peer has no remoteAddress, so this drives the final "unknown"
    // fallback through a real request (TCP peers always expose an address, so a UDS is the
    // only way to exercise that branch end-to-end).
    const socketPath = `/tmp/sg-ip-${process.pid}-${Math.random().toString(36).slice(2)}.sock`;
    const server = appWith({
      ipThrottle: { tryConsume: (id) => {
          seenIp = id;
          return true;
        } },
    }).listen(socketPath);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            socketPath,
            path: `/mcp/${VALID_KEY}`,
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
      });
      expect(status).toBe(200);
      expect(seenIp).toBe("unknown");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      try {
        unlinkSync(socketPath);
      } catch {
        /* socket file already gone */
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Fixed header-key endpoint (`POST /mcp`). Additive: every spec above stays
// byte-unchanged. The personal-URL form (`/mcp/:key`) puts the key in the PATH,
// which two launch channels cannot express — a proxy that forwards to ONE fixed
// upstream can only pass user config as a header, and credential-in-URL is
// discouraged because URLs land in logs, proxies and history. So the same MCP
// handler is also mounted at a fixed `/mcp` that reads the key from a header.
// These specs pin the two properties that matter: header extraction (precedence
// and scheme case-insensitivity) and that the fixed route runs the IDENTICAL
// security pipeline — same 401s, same format-gate-before-DB ordering, and ONE
// shared per-IP budget, so switching routes buys an attacker nothing.
// ---------------------------------------------------------------------------

/** POST the FIXED /mcp endpoint (no path key) with arbitrary headers merged over the defaults. */
const postFixedRpc = (
  baseUrl: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> =>
  fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } as const;

/** Names from a tools/list response body, for comparing the two routes' surfaces. */
const toolNames = (body: { result: { tools: readonly { name: string }[] } }): readonly string[] =>
  body.result.tools.map((tool) => tool.name);

describe("mcp gateway fixed header-key endpoint", () => {
  it("POST /mcp with x-api-key serves the SAME tool surface as the path form (all 24 tools)", async () => {
    // Injecting the production tool set proves the fixed route reaches the real MCP
    // handler, not a reduced one: both routes must advertise the identical 24 tools
    // (19 + list_gsc_properties + track_gsc_property + untrack_project, 2026-08-13;
    // + audit_content, 2026-08-15; + audit_speed, 2026-08-17).
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const viaHeader = await postFixedRpc(app.baseUrl, { "x-api-key": VALID_KEY }, TOOLS_LIST);
      expect(viaHeader.status).toBe(200);
      const headerBody = await viaHeader.json();
      expect(headerBody.result.tools).toHaveLength(24);

      const viaPath = await postRpc(app.baseUrl, VALID_KEY, TOOLS_LIST);
      expect(viaPath.status).toBe(200);
      expect(toolNames(headerBody)).toEqual(toolNames(await viaPath.json()));
    } finally {
      await app.close();
    }
  });

  it("POST /mcp with an `authorization: Bearer <key>` header authenticates", async () => {
    const app = await listen(appWith());
    try {
      const res = await postFixedRpc(
        app.baseUrl,
        { authorization: `Bearer ${VALID_KEY}` },
        TOOLS_LIST,
      );
      expect(res.status).toBe(200);
      expect((await res.json()).result.tools).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("POST /mcp accepts a lowercase `bearer` scheme (scheme match is case-insensitive)", async () => {
    const app = await listen(appWith());
    try {
      const res = await postFixedRpc(
        app.baseUrl,
        { authorization: `bearer ${VALID_KEY}` },
        TOOLS_LIST,
      );
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("POST /mcp with BOTH headers present prefers x-api-key over authorization", async () => {
    const seen: string[] = [];
    const authenticate = vi.fn((key: string) => {
      seen.push(key);
      return Promise.resolve(key === VALID_KEY ? OK_DECISION : UNAUTHORIZED);
    });
    const app = await listen(appWith({ authenticate }));
    try {
      const res = await postFixedRpc(
        app.baseUrl,
        { "x-api-key": VALID_KEY, authorization: "Bearer sg_otherkey9999" },
        TOOLS_LIST,
      );
      expect(res.status).toBe(200);
      // The authenticator is the observation point: it must receive the x-api-key value.
      expect(seen).toEqual([VALID_KEY]);
    } finally {
      await app.close();
    }
  });

  it("POST /mcp with NO key header returns 401 and never calls authenticate (no DB read)", async () => {
    const authenticate = vi.fn(() => Promise.resolve(OK_DECISION));
    const app = await listen(appWith({ authenticate }));
    try {
      const res = await postFixedRpc(app.baseUrl, {}, TOOLS_LIST);
      expect(res.status).toBe(401); // 401, never 403 — a 403 reads as an init failure to scanners
      const body = await res.json();
      expect(body.error.code).toBe(-32001);
      expect(body.jsonrpc).toBe("2.0");
      expect(authenticate).not.toHaveBeenCalled(); // format gate rejects BEFORE any lookup
    } finally {
      await app.close();
    }
  });

  it.each([
    ["x-api-key", { "x-api-key": "not-a-key" }],
    ["authorization", { authorization: "Bearer not-a-key" }],
    ["empty x-api-key", { "x-api-key": "" }],
  ])("POST /mcp with a malformed key in %s returns 401, authenticate never called", async (
    _label,
    headers,
  ) => {
    const authenticate = vi.fn(() => Promise.resolve(OK_DECISION));
    const app = await listen(appWith({ authenticate }));
    try {
      const res = await postFixedRpc(app.baseUrl, headers, TOOLS_LIST);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe(-32001);
      expect(authenticate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(["GET", "DELETE"])("%s /mcp is 405 for a valid key header (parity with the path form)", async (method) => {
    const app = await listen(appWith());
    try {
      const res = await fetch(`${app.baseUrl}/mcp`, {
        method,
        headers: { "x-api-key": VALID_KEY },
      });
      expect(res.status).toBe(405);
      expect((await res.json()).error.code).toBe(-32000);
    } finally {
      await app.close();
    }
  });
});

describe("mcp gateway per-IP throttle is SHARED across both routes", () => {
  // The security property of adding a second route: the per-IP flood budget is ONE
  // accounting store, so an attacker cannot win a fresh allowance by switching from
  // the path form to the header form (or back). A real limiter is used — capacity 1
  // with NO refill — so the first request spends the only token and every later
  // request from that IP is denied regardless of which route it arrives on. Fly-Client-IP
  // is pinned so both requests provably land in the SAME bucket.
  const SAME_IP = { "fly-client-ip": "198.51.100.42" };
  const oneShotThrottle = () => createRateLimiter({ capacity: 1, refillPerSecond: 0 });

  it("budget spent on /mcp/:key -> /mcp is throttled (429) and performs ZERO DB reads", async () => {
    const authenticate = vi.fn(() => Promise.resolve(UNAUTHORIZED));
    const app = await listen(appWith({ authenticate, ipThrottle: oneShotThrottle() }));
    try {
      // Spend the IP's only token on the PATH form with a well-formed-but-invalid key.
      const first = await postRpcWith(app.baseUrl, "sg_floodkey0001", SAME_IP, TOOLS_LIST);
      expect(first.status).toBe(401);
      expect(authenticate).toHaveBeenCalledOnce();

      // Same IP, other route: the shared budget is already empty.
      const second = await postFixedRpc(
        app.baseUrl,
        { ...SAME_IP, "x-api-key": "sg_floodkey0002" },
        TOOLS_LIST,
      );
      expect(second.status).toBe(429);
      expect((await second.json()).error.code).toBe(-32002);
      // Still ONE call in total: the throttled request never reached the lookup.
      expect(authenticate).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("budget spent on /mcp -> /mcp/:key is throttled (429) and performs ZERO DB reads", async () => {
    const authenticate = vi.fn(() => Promise.resolve(UNAUTHORIZED));
    const app = await listen(appWith({ authenticate, ipThrottle: oneShotThrottle() }));
    try {
      const first = await postFixedRpc(
        app.baseUrl,
        { ...SAME_IP, "x-api-key": "sg_floodkey0003" },
        TOOLS_LIST,
      );
      expect(first.status).toBe(401);
      expect(authenticate).toHaveBeenCalledOnce();

      const second = await postRpcWith(app.baseUrl, "sg_floodkey0004", SAME_IP, TOOLS_LIST);
      expect(second.status).toBe(429);
      expect((await second.json()).error.code).toBe(-32002);
      expect(authenticate).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// JSON-only clients. Additive: every spec above stays byte-unchanged. The SDK's
// Streamable HTTP transport 406s a POST whose Accept lacks text/event-stream, but
// this gateway builds that transport with enableJsonResponse: true and never opens
// an SSE stream — so the requirement is vestigial here while a real consumer (a
// directory scanner sending `Accept: application/json`) read back serverInfo:null
// off exactly that 406. These specs pin the widened behaviour on BOTH routes and
// that nothing about what we SEND changed (still a JSON content-type).
// ---------------------------------------------------------------------------

/** The initialize call a directory scanner makes first — the request that was 406ing. */
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "0.0.0" },
  },
} as const;

/** Accept exactly as a JSON-only client sends it (overrides the both-types default). */
const JSON_ONLY = { accept: "application/json" };

describe("mcp gateway accepts JSON-only clients", () => {
  it("POST /mcp/:key initialize with `Accept: application/json` ONLY returns 200 + serverInfo", async () => {
    const app = await listen(appWith());
    try {
      const res = await postRpcWith(app.baseUrl, VALID_KEY, JSON_ONLY, INITIALIZE);
      expect(res.status).toBe(200); // was 406 Not Acceptable
      const body = await res.json();
      expect(body.result.serverInfo.name).toBe("seogrep-mcp");
    } finally {
      await app.close();
    }
  });

  it("POST /mcp (header key) initialize with `Accept: application/json` ONLY returns 200 + serverInfo", async () => {
    const app = await listen(appWith());
    try {
      const res = await postFixedRpc(
        app.baseUrl,
        { "x-api-key": VALID_KEY, ...JSON_ONLY },
        INITIALIZE,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.serverInfo.name).toBe("seogrep-mcp");
    } finally {
      await app.close();
    }
  });

  it("a JSON-only initialize is answered with a JSON content-type (we never start streaming)", async () => {
    const app = await listen(appWith());
    try {
      const res = await postRpcWith(app.baseUrl, VALID_KEY, JSON_ONLY, INITIALIZE);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    } finally {
      await app.close();
    }
  });

  it("the both-types Accept still works on both routes (no regression)", async () => {
    const app = await listen(appWith());
    try {
      const viaPath = await postRpc(app.baseUrl, VALID_KEY, INITIALIZE);
      expect(viaPath.status).toBe(200);
      expect((await viaPath.json()).result.serverInfo.name).toBe("seogrep-mcp");

      const viaHeader = await postFixedRpc(app.baseUrl, { "x-api-key": VALID_KEY }, INITIALIZE);
      expect(viaHeader.status).toBe(200);
      expect((await viaHeader.json()).result.serverInfo.name).toBe("seogrep-mcp");
    } finally {
      await app.close();
    }
  });

  it("the Accept rewrite preserves the request's OTHER headers (200, never 415)", async () => {
    // Widening rewrites the flat rawHeaders array the SDK parses, so the standing risk is
    // dropping a neighbouring header along with the Accept entry. content-type is the
    // observable one: the SDK answers 415 when it is missing, so a 200 proves it survived.
    const app = await listen(appWith());
    try {
      const res = await postRpcWith(
        app.baseUrl,
        VALID_KEY,
        { ...JSON_ONLY, "x-trace": "keep-me" },
        INITIALIZE,
      );
      expect(res.status).not.toBe(415);
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("an Accept that excludes JSON entirely is left alone (still 406 — negotiation intact)", async () => {
    const app = await listen(appWith());
    try {
      const res = await postRpcWith(app.baseUrl, VALID_KEY, { accept: "text/html" }, INITIALIZE);
      expect(res.status).toBe(406);
    } finally {
      await app.close();
    }
  });
});

describe("negotiatedAccept (Accept widening handed to the SDK)", () => {
  // The pure unit proof, testable without HTTP: a client that signalled it takes JSON
  // (explicitly or by wildcard, or by sending no Accept at all) gets text/event-stream
  // added ALONGSIDE its own media types; a client that did not gets undefined, meaning
  // "leave the header alone" so real content negotiation still applies.

  it.each([
    ["explicit JSON", "application/json"],
    ["already both", "application/json, text/event-stream"],
    ["full wildcard", "*/*"],
    ["subtype wildcard", "application/*"],
    ["absent (HTTP default is */*)", undefined],
    ["JSON with quality params", "application/json;q=0.9, text/plain;q=0.1"],
  ])("%s -> a value carrying BOTH application/json and text/event-stream", (_label, raw) => {
    const value = negotiatedAccept(raw);
    expect(value).toBeDefined();
    expect(value).toContain("application/json");
    expect(value).toContain("text/event-stream");
  });

  it("keeps the client's own media types rather than replacing them", () => {
    expect(negotiatedAccept("application/json")).toContain("application/json");
    expect(negotiatedAccept("*/*")).toContain("*/*");
    expect(negotiatedAccept("application/*")).toContain("application/*");
  });

  it("does NOT duplicate text/event-stream when the client already sent both", () => {
    const raw = "application/json, text/event-stream";
    const value = negotiatedAccept(raw);
    expect(value).toBe(raw); // nothing to add — handed through untouched
    expect(value?.match(/text\/event-stream/g)).toHaveLength(1);
  });

  it.each([
    ["HTML only", "text/html"],
    ["text wildcard that does not cover JSON", "text/*"],
    ["a non-JSON application subtype", "application/xml"],
  ])("%s -> undefined (leave the header alone; the SDK may still 406)", (_label, raw) => {
    expect(negotiatedAccept(raw)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Public capability card (`GET /.well-known/mcp/server-card.json`). Additive:
// every spec above stays byte-unchanged. This gateway is auth-walled — every MCP
// call needs a per-user key — so an anonymous directory scanner cannot reach
// initialize/tools/list and reads back no capabilities at all (Smithery measured
// `serverInfo:null` against production). The documented remedy is a STATIC card at
// this well-known path. These specs pin the three properties that make it safe and
// useful: it answers unauthenticated, it is generated from the SAME registry
// tools/list serves (so it cannot drift), and it costs nothing — no auth, no DB,
// and it never spends a per-IP throttle token.
// ---------------------------------------------------------------------------

/** The well-known path, spelled out here so a route rename fails these specs loudly. */
const CARD_PATH = "/.well-known/mcp/server-card.json";

/** One tool entry as the card publishes it — the shape of a tools/list result entry. */
interface CardToolEntry {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const fetchCard = (baseUrl: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${baseUrl}${CARD_PATH}`, { headers });

describe("mcp gateway public server card", () => {
  it("GET the card with NO auth returns 200 + a JSON content-type + the seogrep-mcp serverInfo", async () => {
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const res = await fetchCard(app.baseUrl); // no key in the path, no key header
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const card = await res.json();
      expect(card.serverInfo.name).toBe("seogrep-mcp");
      expect(typeof card.serverInfo.version).toBe("string");
      expect(card.serverInfo.version.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("the card lists EXACTLY the registry's tool names (asserted against ALL_TOOLS, not a fixed list)", async () => {
    // Compared to the registry itself so the spec stays true when a tool is added or
    // removed — a hardcoded list of names would have to be edited alongside the change,
    // which is precisely the drift this card must not have.
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const card = await (await fetchCard(app.baseUrl)).json();
      expect(card.tools.map((tool: CardToolEntry) => tool.name)).toEqual(
        ALL_TOOLS.map((tool) => tool.name),
      );
    } finally {
      await app.close();
    }
  });

  it("the card's tool names match what an AUTHENTICATED tools/list returns (one source, two surfaces)", async () => {
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const card = await (await fetchCard(app.baseUrl)).json();
      const listed = await postRpc(app.baseUrl, VALID_KEY, TOOLS_LIST);
      expect(listed.status).toBe(200);
      expect(card.tools.map((tool: CardToolEntry) => tool.name)).toEqual(
        toolNames(await listed.json()),
      );
    } finally {
      await app.close();
    }
  });

  it("every card tool carries a non-empty description and an inputSchema OBJECT", async () => {
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const card = await (await fetchCard(app.baseUrl)).json();
      expect(card.tools.length).toBe(ALL_TOOLS.length);
      for (const tool of card.tools as CardToolEntry[]) {
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.inputSchema).toBe("object");
        expect(tool.inputSchema).not.toBeNull();
        expect(Array.isArray(tool.inputSchema)).toBe(false);
      }
    } finally {
      await app.close();
    }
  });

  it("serving the card NEVER calls authenticate (unauthenticated by construction, zero DB reads)", async () => {
    // authenticate is where the api_keys lookup lives, so "never called" is the proof that
    // the card route performs no authentication AND touches no database — the same
    // observation point the throttle and header-key specs above use.
    const authenticate = vi.fn(() => Promise.resolve(OK_DECISION));
    const app = await listen(appWith({ authenticate, tools: ALL_TOOLS }));
    try {
      const res = await fetchCard(app.baseUrl);
      expect(res.status).toBe(200);
      expect(authenticate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("the card is served with a conservative public Cache-Control (it is static per deploy)", async () => {
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const res = await fetchCard(app.baseUrl);
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    } finally {
      await app.close();
    }
  });

  it("the card describes the REAL key-based auth and claims no OAuth we do not implement", async () => {
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const card = await (await fetchCard(app.baseUrl)).json();
      expect(card.authentication.required).toBe(true);
      expect(card.authentication.schemes).toEqual(["apiKey"]);
      expect(card.authentication.description).toContain("x-api-key");
      expect(card.authentication.description).toContain("https://mcp.seogrep.com/mcp/{key}");
      // The WHOLE serialized payload, case-insensitively — not just the auth block, and not
      // just the exact string "oauth2". Tool descriptions are ordinary editable prose (two
      // tool modules already discuss OAuth in their comments), so a description that picked
      // the word up would re-create exactly the scanner misclassification this card avoids.
      expect(JSON.stringify(card).toLowerCase()).not.toContain("oauth");
    } finally {
      await app.close();
    }
  });

  it("the card is readable cross-origin (browser-based validators fetch it directly)", async () => {
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const res = await fetchCard(app.baseUrl);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    } finally {
      await app.close();
    }
  });

  it("the card advertises the URL template the APP was built with (D28 wiring, end to end)", async () => {
    // The route-level half of the D28 guard: production resolves MCP_URL_TEMPLATE at the
    // composition root and hands it to the card, so what the app was built with is what the
    // public document says. Injecting a non-default template here proves that whole path.
    const app = await listen(
      appWith({ tools: ALL_TOOLS, mcpUrlTemplate: "https://example.test/gateway/{key}" }),
    );
    try {
      const card = await (await fetchCard(app.baseUrl)).json();
      expect(card.authentication.description).toContain("https://example.test/gateway/{key}");
      expect(card.authentication.description).not.toContain("mcp.seogrep.com");
    } finally {
      await app.close();
    }
  });
});

describe("mcp gateway public server card does not spend the per-IP throttle", () => {
  // The card is a public, zero-cost document: serving it must not eat a token from the
  // flood budget that protects the MCP routes, or a directory scanner polling the card
  // would lock the real endpoint out for everyone behind that IP. A REAL limiter with
  // capacity 1 and NO refill is used (same idiom as the shared-throttle specs above), so
  // the single token is provably still there after the card has been fetched repeatedly.
  const CARD_IP = { "fly-client-ip": "198.51.100.77" };

  it("card fetches leave the IP's only token intact for a later MCP request", async () => {
    const authenticate = vi.fn(() => Promise.resolve(UNAUTHORIZED));
    const app = await listen(
      appWith({
        authenticate,
        tools: ALL_TOOLS,
        ipThrottle: createRateLimiter({ capacity: 1, refillPerSecond: 0 }),
      }),
    );
    try {
      for (let i = 0; i < 3; i += 1) {
        expect((await fetchCard(app.baseUrl, CARD_IP)).status).toBe(200);
      }

      // The token was never spent, so the MCP request still gets through to the lookup
      // (401 from authenticate, NOT the 429 a spent budget would produce).
      const mcp = await postRpcWith(app.baseUrl, "sg_cardkey00001", CARD_IP, TOOLS_LIST);
      expect(mcp.status).toBe(401);
      expect(authenticate).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("serving the card never consults the throttle at all (tryConsume is not called)", async () => {
    const tryConsume = vi.fn(() => true);
    const app = await listen(appWith({ tools: ALL_TOOLS, ipThrottle: { tryConsume } }));
    try {
      expect((await fetchCard(app.baseUrl, CARD_IP)).status).toBe(200);
      expect(tryConsume).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe("mcp gateway security response headers (L-12)", () => {
  // The gateway is a PUBLIC, unauthenticated-by-default HTTP surface, so every answer it
  // emits — MCP dispatch, the 401/405 rejections, the operator signal and the capability
  // card alike — carries the same baseline hardening: no framework advertisement
  // (x-powered-by), no MIME sniffing, no referrer leakage of a path-form key, and no
  // framing. Asserted on the REAL routes rather than on a header constant, so a route that
  // bypasses the middleware would fail here.

  it("never advertises the Express stack on an MCP response", async () => {
    const app = await listen(appWith());
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, TOOLS_LIST);
      expect(res.headers.get("x-powered-by")).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("sets nosniff, referrer-policy and anti-framing headers on an MCP response", async () => {
    const app = await listen(appWith());
    try {
      const res = await postRpc(app.baseUrl, VALID_KEY, TOOLS_LIST);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    } finally {
      await app.close();
    }
  });

  it("hardens the unauthenticated 401 rejection too (a bad key still gets the headers)", async () => {
    const app = await listen(appWith());
    try {
      const res = await postRpc(app.baseUrl, "not-a-key", TOOLS_LIST);
      expect(res.status).toBe(401);
      expect(res.headers.get("x-powered-by")).toBeNull();
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    } finally {
      await app.close();
    }
  });

  it("hardens the public /status and capability-card surfaces", async () => {
    const app = await listen(appWith({ tools: ALL_TOOLS }));
    try {
      const status = await fetch(`${app.baseUrl}/status`);
      expect(status.headers.get("x-powered-by")).toBeNull();
      expect(status.headers.get("x-content-type-options")).toBe("nosniff");

      const card = await fetchCard(app.baseUrl);
      expect(card.headers.get("x-powered-by")).toBeNull();
      expect(card.headers.get("x-content-type-options")).toBe("nosniff");
      // Hardening is additive: the card keeps the cache + CORS headers it exists to serve.
      expect(card.headers.get("access-control-allow-origin")).toBe("*");
      expect(card.headers.get("cache-control")).toBe("public, max-age=300");
    } finally {
      await app.close();
    }
  });

  it("leaves /healthz's status code and body byte-identical (the uptime monitor's contract)", async () => {
    // Hardening adds RESPONSE HEADERS only. /healthz is the live uptime probe, so its
    // status and payload must be exactly what they were before this slice.
    const app = await listen(appWith());
    try {
      const res = await fetch(`${app.baseUrl}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(JSON.stringify({ ok: true }));
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// H-05 — the anonymous /status amplification. /status is unauthenticated and, before
// this slice, ungated: every hit ran countPendingJobs, an EXACT count over `jobs` with
// no index on `status`. The 1s bound capped only the ANSWER — the query underneath kept
// running — so N concurrent anonymous requests became N concurrent full scans, and that
// load landed on the same database the auth lookup, the queue and the credit ledger use.
//
// Three properties close it, and each is pinned below:
//   1. CANCELLATION — when the deadline wins, the underlying read is aborted, not orphaned.
//   2. CACHE        — N concurrent requests cost at most ONE query (proven with a counter).
//   3. THROTTLE     — a per-IP gate, on its own budget, that answers before any read.
// /healthz is deliberately excluded from all three (it is the live uptime probe).
// ---------------------------------------------------------------------------

describe("readPendingJobsBounded cancellation (H-05)", () => {
  it("ABORTS the underlying read when the deadline wins (the query is not orphaned)", async () => {
    let aborted = false;
    const hangUntilAborted = (signal: AbortSignal) =>
      new Promise<number>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await readPendingJobsBounded(hangUntilAborted, 20)).toBeNull();
      expect(aborted).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("hands the reader a signal that is NOT aborted while it is still within the deadline", async () => {
    let seen: AbortSignal | undefined;
    const read = (signal: AbortSignal) => {
      seen = signal;
      return Promise.resolve(5);
    };
    expect(await readPendingJobsBounded(read, 1_000)).toBe(5);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });
});

describe("createPendingJobsCache (H-05 — one query, not N)", () => {
  let ms = 0;
  const now = () => ms;

  it("collapses CONCURRENT reads into a single query (single-flight)", async () => {
    let queries = 0;
    const read = () => {
      queries += 1;
      return new Promise<number>((resolve) => setTimeout(() => resolve(9), 20));
    };
    const cache = createPendingJobsCache(read, { timeoutMs: 1_000, ttlMs: 5_000 });
    const results = await Promise.all(Array.from({ length: 20 }, () => cache()));
    expect(results).toEqual(Array.from({ length: 20 }, () => 9));
    expect(queries).toBe(1);
  });

  it("serves a SEQUENTIAL read from cache while the entry is fresh", async () => {
    let queries = 0;
    ms = 0;
    const read = () => {
      queries += 1;
      return Promise.resolve(4);
    };
    const cache = createPendingJobsCache(read, { timeoutMs: 1_000, ttlMs: 5_000, now });
    expect(await cache()).toBe(4);
    ms += 4_999;
    expect(await cache()).toBe(4);
    expect(queries).toBe(1);
  });

  it("re-reads once the TTL has expired (the signal stays live, it is not frozen)", async () => {
    let queries = 0;
    ms = 0;
    const read = () => {
      queries += 1;
      return Promise.resolve(queries);
    };
    const cache = createPendingJobsCache(read, { timeoutMs: 1_000, ttlMs: 5_000, now });
    expect(await cache()).toBe(1);
    ms += 5_001;
    expect(await cache()).toBe(2);
    expect(queries).toBe(2);
  });

  it("caches the DEGRADED null too, so a slow DB is not re-queried on every hit", async () => {
    // Worst exactly when the DB is unwell: an uncached null is re-queried by every hit.
    let queries = 0;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const read = (signal: AbortSignal) => {
        queries += 1;
        return new Promise<number>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      };
      const cache = createPendingJobsCache(read, { timeoutMs: 10, ttlMs: 5_000 });
      expect(await cache()).toBeNull();
      expect(await cache()).toBeNull();
      expect(await cache()).toBeNull();
      expect(queries).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("never queries at all when no reader is wired", async () => {
    const cache = createPendingJobsCache(undefined, { timeoutMs: 1_000, ttlMs: 5_000 });
    expect(await cache()).toBeNull();
  });
});

describe("mcp gateway /status flood resistance (H-05)", () => {
  const FLOOD_IP = { "fly-client-ip": "203.0.113.9" };

  it("N concurrent anonymous /status requests cost at most ONE backlog query", async () => {
    let queries = 0; // the finding, measured end to end: uncached, this counter reads 25
    const app = await listen(
      appWith({
        pendingJobs: () => {
          queries += 1;
          return new Promise<number>((resolve) => setTimeout(() => resolve(2), 20));
        },
      }),
    );
    try {
      const responses = await Promise.all(
        Array.from({ length: 25 }, () => fetch(`${app.baseUrl}/status`)),
      );
      expect(responses.every((res) => res.status === 200)).toBe(true);
      const bodies = await Promise.all(responses.map((res) => res.json()));
      expect(bodies.every((body) => body.pendingJobs === 2)).toBe(true);
      expect(queries).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("throttles a per-IP /status flood with 429 and reads NOTHING once throttled", async () => {
    let queries = 0;
    const app = await listen(
      appWith({
        pendingJobs: () => {
          queries += 1;
          return Promise.resolve(0);
        },
        statusThrottle: createRateLimiter({ capacity: 1, refillPerSecond: 0 }),
      }),
    );
    try {
      const first = await fetch(`${app.baseUrl}/status`, { headers: FLOOD_IP });
      expect(first.status).toBe(200);

      const second = await fetch(`${app.baseUrl}/status`, { headers: FLOOD_IP });
      expect(second.status).toBe(429);
      expect((await second.json()).ok).toBe(false);

      expect(queries).toBe(1); // the 429 never reached the backlog reader
    } finally {
      await app.close();
    }
  });

  it("does NOT spend the MCP flood budget (a /status poll cannot lock out the real endpoint)", async () => {
    // Same discipline as the capability card: the two gates keep SEPARATE accounting, so a
    // scanner hammering /status can never exhaust the budget protecting /mcp.
    const authenticate = vi.fn(() => Promise.resolve(UNAUTHORIZED));
    const app = await listen(
      appWith({
        authenticate,
        ipThrottle: createRateLimiter({ capacity: 1, refillPerSecond: 0 }),
        statusThrottle: createRateLimiter({ capacity: 50, refillPerSecond: 0 }),
      }),
    );
    try {
      for (let i = 0; i < 5; i += 1) {
        expect((await fetch(`${app.baseUrl}/status`, { headers: FLOOD_IP })).status).toBe(200);
      }
      const mcp = await postRpcWith(app.baseUrl, "sg_statuskey001", FLOOD_IP, TOOLS_LIST);
      expect(mcp.status).toBe(401); // reached the lookup — the MCP token was never spent
      expect(authenticate).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("leaves /healthz un-throttled and un-cached (the uptime probe must never 429)", async () => {
    const app = await listen(
      appWith({ statusThrottle: createRateLimiter({ capacity: 1, refillPerSecond: 0 }) }),
    );
    try {
      for (let i = 0; i < 5; i += 1) {
        const res = await fetch(`${app.baseUrl}/healthz`, { headers: FLOOD_IP });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(JSON.stringify({ ok: true }));
      }
    } finally {
      await app.close();
    }
  });
});

describe("countPendingJobs cancellation wiring (H-05)", () => {
  // The /status backlog reader is the one query the finding is about. Driven here against a
  // hand-rolled fake builder — no database, no network — purely to prove the caller's signal
  // reaches PostgREST, so an abandoned /status answer abandons its HTTP request too.

  function fakeClient(signalSink: { signal?: AbortSignal }) {
    const builder = {
      select: () => builder,
      in: () => builder,
      abortSignal: (signal: AbortSignal) => {
        signalSink.signal = signal;
        return builder;
      },
      then: (resolve: (value: { count: number; error: null }) => unknown) =>
        Promise.resolve({ count: 7, error: null }).then(resolve),
    };
    return { from: () => builder } as unknown as Parameters<typeof countPendingJobs>[0];
  }

  it("passes the caller's AbortSignal down to the query", async () => {
    const sink: { signal?: AbortSignal } = {};
    const controller = new AbortController();
    expect(await countPendingJobs(fakeClient(sink), controller.signal)).toBe(7);
    expect(sink.signal).toBe(controller.signal);
  });

  it("still works with no signal (the reader stays usable outside /status)", async () => {
    const sink: { signal?: AbortSignal } = {};
    expect(await countPendingJobs(fakeClient(sink))).toBe(7);
    expect(sink.signal).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// M-13 (part 2) — CLOUD SCHEMA READINESS. Nothing tied a deploy to whether the cloud database
// had the migrations the shipped code calls: code and migrations merge together, so Fly can
// start serving a build that calls an RPC the cloud project does not have yet (today, live,
// the cloud schema sits behind the committed migrations).
//
// This is deliberately OBSERVABILITY, not enforcement: a refuse-to-serve gate would take
// production down the moment it deployed. /status gains a schema field and NOTHING else
// changes — the server boots, serves and dispatches tools exactly as before while the field
// reads not_ready. Four properties are pinned below:
//   1. REPORTED   — /status carries the readiness answer and names what it measured.
//   2. HONEST     — a missing object reads not_ready; a FAILED probe reads unknown, never ready.
//   3. BOUNDED    — N anonymous requests cost at most ONE probe (the H-05 lesson, not repeated).
//   4. NON-FATAL  — not_ready never stops the server from serving.
// ---------------------------------------------------------------------------

/** The requirement string /status advertises — pinned literally so the payload cannot drift. */
const SCHEMA_REQUIRES = "rpc:dfs_spend_today_usd";

describe("mcp gateway /status schema readiness (M-13)", () => {
  it("reports ready and NAMES the capability it probed", async () => {
    const app = await listen(appWith({ schemaReadiness: () => Promise.resolve("ready") }));
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schema).toEqual({ status: "ready", requires: SCHEMA_REQUIRES });
    } finally {
      await app.close();
    }
  });

  it("reports not_ready (never ready) when the probe finds the newest object MISSING", async () => {
    const app = await listen(appWith({ schemaReadiness: () => Promise.resolve("not_ready") }));
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true); // still an answer — this endpoint reports, it does not gate
      expect(body.schema.status).toBe("not_ready");
    } finally {
      await app.close();
    }
  });

  it("reports unknown (never ready) when the probe REJECTS", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = await listen(
      appWith({ schemaReadiness: () => Promise.reject(new Error("db unreachable")) }),
    );
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schema.status).toBe("unknown");
    } finally {
      warnSpy.mockRestore();
      await app.close();
    }
  });

  it("reports unknown (never ready) when the probe THROWS SYNCHRONOUSLY", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = await listen(
      appWith({
        schemaReadiness: () => {
          throw new Error("sync boom");
        },
      }),
    );
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schema.status).toBe("unknown");
    } finally {
      warnSpy.mockRestore();
      await app.close();
    }
  });

  it("reports unknown when no probe is wired (an unmeasured schema is never 'ready')", async () => {
    const app = await listen(appWith());
    try {
      const res = await fetch(`${app.baseUrl}/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schema).toEqual({ status: "unknown", requires: SCHEMA_REQUIRES });
    } finally {
      await app.close();
    }
  });

  it("N concurrent anonymous /status requests cost at most ONE schema probe (H-05)", async () => {
    let probes = 0; // uncached this reads 25 — the exact amplifier H-05 was about
    const app = await listen(
      appWith({
        schemaReadiness: () => {
          probes += 1;
          return new Promise<"ready">((resolve) => setTimeout(() => resolve("ready"), 20));
        },
      }),
    );
    try {
      const responses = await Promise.all(
        Array.from({ length: 25 }, () => fetch(`${app.baseUrl}/status`)),
      );
      expect(responses.every((res) => res.status === 200)).toBe(true);
      const bodies = await Promise.all(responses.map((res) => res.json()));
      expect(bodies.every((body) => body.schema.status === "ready")).toBe(true);
      expect(probes).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("keeps SERVING while the schema reads not_ready (observability, never enforcement)", async () => {
    // The whole point of shipping this as a report: the cloud schema is genuinely behind right
    // now, so a gate that failed closed would black out production on deploy. Boot, health,
    // and a real authenticated tools/list dispatch must all be untouched by not_ready.
    const app = await listen(
      appWith({ schemaReadiness: () => Promise.resolve("not_ready"), tools: ALL_TOOLS }),
    );
    try {
      expect((await fetch(`${app.baseUrl}/healthz`)).status).toBe(200);
      const res = await postRpc(app.baseUrl, VALID_KEY, TOOLS_LIST);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.tools.length).toBe(ALL_TOOLS.length);
      expect((await (await fetch(`${app.baseUrl}/status`)).json()).schema.status).toBe("not_ready");
    } finally {
      await app.close();
    }
  });
});

describe("readSchemaStatusBounded (bounded best-effort readiness probe)", () => {
  it("passes a definitive answer straight through", async () => {
    expect(await readSchemaStatusBounded(() => Promise.resolve("ready"), 1_000)).toBe("ready");
    expect(await readSchemaStatusBounded(() => Promise.resolve("not_ready"), 1_000)).toBe("not_ready");
  });

  it("resolves unknown (never hangs, never 'ready') when the probe exceeds the timeout", async () => {
    const hang = () => new Promise<"ready">(() => undefined); // never settles
    const start = Date.now();
    expect(await readSchemaStatusBounded(hang, 20)).toBe("unknown");
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it("ABORTS the underlying probe when the deadline wins (the query is not orphaned)", async () => {
    let aborted = false;
    const hangUntilAborted = (signal: AbortSignal) =>
      new Promise<"ready">((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await readSchemaStatusBounded(hangUntilAborted, 20)).toBe("unknown");
      expect(aborted).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("resolves unknown when no probe is wired", async () => {
    expect(await readSchemaStatusBounded(undefined, 1_000)).toBe("unknown");
  });
});

describe("createSchemaStatusCache (one probe, not N)", () => {
  let ms = 0;
  const now = () => ms;

  it("collapses CONCURRENT probes into a single query (single-flight)", async () => {
    let probes = 0;
    const read = () => {
      probes += 1;
      return new Promise<"ready">((resolve) => setTimeout(() => resolve("ready"), 20));
    };
    const cache = createSchemaStatusCache(read, { timeoutMs: 1_000, ttlMs: 60_000 });
    const results = await Promise.all(Array.from({ length: 20 }, () => cache()));
    expect(results).toEqual(Array.from({ length: 20 }, () => "ready"));
    expect(probes).toBe(1);
  });

  it("NEVER probes again once the schema has read ready (migrations are forward-only)", async () => {
    ms = 0;
    let probes = 0;
    const read = () => {
      probes += 1;
      return Promise.resolve("ready" as const);
    };
    const cache = createSchemaStatusCache(read, { timeoutMs: 1_000, ttlMs: 60_000, now });
    expect(await cache()).toBe("ready");
    ms += 10 * 60_000; // ten TTLs later
    expect(await cache()).toBe("ready");
    expect(probes).toBe(1);
  });

  it("re-probes a not_ready answer once the TTL expires, so it CONVERGES after a human migrates", async () => {
    ms = 0;
    let probes = 0;
    const read = () => {
      probes += 1;
      return Promise.resolve(probes === 1 ? ("not_ready" as const) : ("ready" as const));
    };
    const cache = createSchemaStatusCache(read, { timeoutMs: 1_000, ttlMs: 60_000, now });
    expect(await cache()).toBe("not_ready");
    ms += 59_999;
    expect(await cache()).toBe("not_ready"); // still fresh — no second probe
    expect(probes).toBe(1);
    ms += 2;
    expect(await cache()).toBe("ready");
    expect(probes).toBe(2);
  });

  it("caches the DEGRADED unknown too, so a sick DB is not re-probed on every hit", async () => {
    let probes = 0;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const read = (signal: AbortSignal) => {
        probes += 1;
        return new Promise<"ready">((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      };
      const cache = createSchemaStatusCache(read, { timeoutMs: 10, ttlMs: 60_000 });
      expect(await cache()).toBe("unknown");
      expect(await cache()).toBe("unknown");
      expect(await cache()).toBe("unknown");
      expect(probes).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("never probes at all when no reader is wired", async () => {
    const cache = createSchemaStatusCache(undefined, { timeoutMs: 1_000, ttlMs: 60_000 });
    expect(await cache()).toBe("unknown");
  });
});
