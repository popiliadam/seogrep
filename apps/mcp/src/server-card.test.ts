import { describe, expect, it } from "vitest";
import { DEFAULT_MCP_URL_TEMPLATE } from "@pseo/core";
import { SERVER_CARD_PATH, buildServerCard } from "./server-card.ts";
import { ALL_TOOLS } from "./tools/index.ts";

// The pure proof of the capability card, testable without HTTP: buildServerCard is a
// deterministic projection of (serverInfo, capabilities, registry) onto the static JSON a
// directory scanner reads at SERVER_CARD_PATH. The route-level behaviour (unauthenticated,
// no DB, no throttle) is pinned in server.test.ts; what is pinned HERE is the payload —
// that the tool list is a faithful, drift-free copy of the registry, that the advertised
// endpoints match the one canonical URL template, and that the auth story is the real one.

const SERVER_INFO = { name: "seogrep-mcp", version: "0.0.1" } as const;
const CAPABILITIES = { tools: {}, prompts: {} } as const;

const card = () =>
  buildServerCard({
    serverInfo: SERVER_INFO,
    capabilities: CAPABILITIES,
    tools: ALL_TOOLS,
    mcpUrlTemplate: DEFAULT_MCP_URL_TEMPLATE,
  });

describe("buildServerCard", () => {
  it("serves at the well-known path the directory scanners probe", () => {
    expect(SERVER_CARD_PATH).toBe("/.well-known/mcp/server-card.json");
  });

  it("echoes the serverInfo it is given (the handshake's identity, not a second copy)", () => {
    expect(card().serverInfo).toEqual({ name: "seogrep-mcp", version: "0.0.1" });
  });

  it("echoes the capabilities it is given (the same object the MCP Server advertises)", () => {
    expect(card().capabilities).toEqual({ tools: {}, prompts: {} });
  });

  it("projects EVERY registry tool, in registry order, as a tools/list-shaped entry", () => {
    expect(card().tools).toEqual(
      ALL_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputJsonSchema,
      })),
    );
  });

  it("carries no tools when the registry is empty (a projection, never a hardcoded list)", () => {
    const empty = buildServerCard({
      serverInfo: SERVER_INFO,
      capabilities: CAPABILITIES,
      tools: [],
      mcpUrlTemplate: DEFAULT_MCP_URL_TEMPLATE,
    });
    expect(empty.tools).toEqual([]);
  });

  it("declares authentication as required, api-key based, and never as OAuth", () => {
    const { authentication } = card();
    expect(authentication.required).toBe(true);
    expect(authentication.schemes).toEqual(["apiKey"]);
    expect(authentication.description.toLowerCase()).not.toContain("oauth");
  });

  it("documents BOTH real key carriers: the personal URL path and the x-api-key header", () => {
    const { description } = card().authentication;
    expect(description).toContain(DEFAULT_MCP_URL_TEMPLATE);
    expect(description).toContain("https://mcp.seogrep.com/mcp");
    expect(description).toContain("x-api-key");
    expect(description).toContain("Bearer");
  });

  it("advertises the personal URL exactly as the one canonical template in @pseo/core", () => {
    // Given the DEFAULT template (what an unset MCP_URL_TEMPLATE resolves to), the card must
    // quote it verbatim rather than paraphrase it into a second, separately-edited copy.
    expect(card().authentication.description).toContain(DEFAULT_MCP_URL_TEMPLATE);
  });

  it("advertises the INJECTED template, so an MCP_URL_TEMPLATE change reaches the card (D28)", () => {
    // The public-honesty guard behind decision D28: the URL shape is env-driven precisely so
    // it can change with ONE env edit. If the card quoted a compiled-in constant instead, a
    // template change would update the dashboard while the card kept advertising a stale,
    // publicly-visible URL. Injecting a non-default template proves the card follows the env.
    const injected = "https://example.test/gateway/{key}";
    const built = buildServerCard({
      serverInfo: SERVER_INFO,
      capabilities: CAPABILITIES,
      tools: ALL_TOOLS,
      mcpUrlTemplate: injected,
    });
    expect(built.authentication.description).toContain(injected);
    // The fixed (header-key) endpoint is DERIVED from that same template, never hardcoded.
    expect(built.authentication.description).toContain("fixed endpoint https://example.test/gateway,");
    // ...and no trace of the default survives, so nothing is quoting a stale constant.
    expect(built.authentication.description).not.toContain(DEFAULT_MCP_URL_TEMPLATE);
    expect(built.authentication.description).not.toContain("mcp.seogrep.com");
  });

  it("survives JSON round-tripping unchanged (it is served verbatim as a static document)", () => {
    const built = card();
    expect(JSON.parse(JSON.stringify(built))).toEqual(built);
  });
});
