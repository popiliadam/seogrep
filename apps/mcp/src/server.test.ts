import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { createApp, hasValidKeyFormat } from "./server.ts";

const VALID_KEY = "sg_testkey1234";

describe("hasValidKeyFormat", () => {
  it("accepts an sg_-prefixed key with a body", () => {
    expect(hasValidKeyFormat(VALID_KEY)).toBe(true);
  });

  it.each(["", "sg_", "nope", "SG_upper", " sg_x"])(
    "rejects malformed key %j",
    (key) => {
      expect(hasValidKeyFormat(key)).toBe(false);
    },
  );
});

describe("mcp gateway app", () => {
  let server: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  const postRpc = (key: string, body: unknown): Promise<Response> =>
    fetch(`${baseUrl}/mcp/${key}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    });

  it("GET /healthz returns { ok: true }", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST /mcp/:key with a malformed key returns 401 JSON-RPC error", async () => {
    const res = await postRpc("not-a-key", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe(-32001);
    expect(body.jsonrpc).toBe("2.0");
  });

  it.each(["GET", "DELETE"])("%s /mcp/:key is 405 for a valid key format", async (method) => {
    const res = await fetch(`${baseUrl}/mcp/${VALID_KEY}`, { method });
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe(-32000);
  });

  it("POST initialize returns the seogrep-mcp server info", async () => {
    const res = await postRpc(VALID_KEY, {
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

  it("POST tools/list returns an empty tool list", async () => {
    const res = await postRpc(VALID_KEY, {
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
