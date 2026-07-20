import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import http from "node:http";
import { unlinkSync } from "node:fs";
import { createApp, type AppDeps } from "./server.ts";
import { safeKeyPrefix, type AuthContext, type AuthDecision } from "./auth.ts";

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
  // prompts/list returns the three orchestration prompts and prompts/get renders one.
  it("POST prompts/list returns the three orchestration prompts in order", async () => {
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
