import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { createApp, type AppDeps } from "./server.ts";
import type { AuthContext } from "./auth.ts";

// server.test.ts evolves the T1 format-gate suite into the real auth contract: the
// app is exercised through an INJECTED authenticate + rateLimiter (no DB), so the
// "valid key -> dispatch" cases now require a resolved tenant context, and two new
// surfaces are asserted — 401 for a well-formed-but-unknown key, and 429 when the
// rate limiter rejects. The pure hasValidKeyFormat unit cases moved with the
// function to auth.test.ts. No prior assertion was weakened.

const VALID_KEY = "sg_testkey1234";
const CONTEXT: AuthContext = { userId: "user-A", keyId: "key-1" };

/** Build the app with fake, DB-free deps. Overrides let a test force a path. */
function appWith(overrides: Partial<AppDeps> = {}): ReturnType<typeof createApp> {
  const deps: AppDeps = {
    authenticate: (key) => Promise.resolve(key === VALID_KEY ? CONTEXT : null),
    rateLimiter: { tryConsume: () => true },
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

describe("mcp gateway rate limiting", () => {
  it("returns 429 JSON-RPC error when the per-key limiter rejects", async () => {
    const app = await listen(appWith({ rateLimiter: { tryConsume: () => false } }));
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
