import type { RegisteredTool } from "./tools/registry.ts";

/**
 * The PUBLIC capability card this gateway serves, unauthenticated, at SERVER_CARD_PATH.
 *
 * WHY it exists: every MCP call here needs a per-user key, so an anonymous directory
 * scanner cannot run initialize/tools/list and learns nothing about us. Smithery's scan of
 * production reported `{"status":{"state":"connected"},"serverInfo":null}` — it reached the
 * gateway and read back no capabilities, so the listing showed zero tools. A static card is
 * the documented remedy: it tells a scanner what a successful handshake WOULD have told it,
 * without handing anyone a way in.
 *
 * SHAPE: the static-card schema Smithery documents for this path — `serverInfo` plus optional
 * `authentication` and capability arrays, with each tool entry shaped exactly like a
 * `tools/list` result entry (name / description / inputSchema). That is a VENDOR convention
 * rather than a ratified standard: the MCP working group's own draft (SEP-1649 -> SEP-2127)
 * uses a different document at a different path and DELIBERATELY omits primitive lists, so it
 * cannot express the one thing this card exists to publish — the tools.
 *
 * DERIVED, NEVER HAND-MAINTAINED: the tool entries are a projection of the same registry
 * `tools/list` serves, serverInfo/capabilities are passed in from the values the MCP Server
 * instance itself is constructed with, and the advertised URL comes from the SAME env-driven
 * template the dashboard renders (decision D28). There is no second copy of any of it to drift.
 *
 * PURE: this module reads no environment and performs no I/O. Every environment-dependent
 * value — the URL template above included — is resolved by the composition root and passed
 * in, so the card is a deterministic function of its inputs and stays trivially testable.
 *
 * DISCLOSURE: everything published here is ALREADY public — the docs site lists all of these
 * tools with their descriptions and input fields (apps/web/content/docs/tools-reference/,
 * generated from this same registry). No tenant data, no counts of users or jobs, no
 * infrastructure detail, and no credit internals beyond what those pages already state.
 * `resources` and `prompts` are OMITTED rather than sent as empty arrays: they are optional,
 * and an empty array would assert "this server has none", which for prompts is untrue.
 */

/**
 * Where directory scanners look for the card. Fixed by the convention this card follows, and
 * chosen to sit under `/.well-known/` so it cannot collide with `/mcp` or `/mcp/:key`.
 */
export const SERVER_CARD_PATH = "/.well-known/mcp/server-card.json";

/**
 * Cache policy for the card. It is compiled-in and static for the life of a deployment, so it
 * is safely `public`; 5 minutes is deliberately SHORT for something that only changes on
 * deploy — long enough to absorb a scanner's retries and repeated probes, short enough that a
 * re-scan run right after a release sees the new tool set without anyone purging a cache.
 */
export const SERVER_CARD_CACHE_CONTROL = "public, max-age=300";

/** The `/{key}` placeholder segment the personal-URL template ends with. */
const KEY_PLACEHOLDER_SEGMENT = "/{key}";

/**
 * How clients actually authenticate, stated honestly and in full, for the personal-URL
 * `template` this deployment advertises. Both real carriers are named because clients differ:
 * some cannot send custom headers (they get the personal URL), and proxies that forward to one
 * fixed upstream can only pass user config as a header. The fixed endpoint is DERIVED from the
 * same template rather than written out again, so the two advertised forms cannot describe
 * different hosts. No authorization server, token endpoint or client registration exists here
 * — the card must not imply a delegated-authorization flow this gateway does not implement.
 */
function authenticationDescription(template: string): string {
  const fixedEndpoint = template.replace(KEY_PLACEHOLDER_SEGMENT, "");
  return (
    "Every request needs a personal SeoGrep API key, created in the SeoGrep dashboard at " +
    "https://seogrep.com (free trial, no card). Supply it in ONE of two equivalent ways: as " +
    `the last path segment of your personal URL ${template}, or, against the fixed endpoint ` +
    `${fixedEndpoint}, in an "x-api-key" request header ("Authorization: Bearer <key>" is ` +
    "accepted as a fallback). Keys are the only accepted credential: there is no authorization " +
    "server, no token endpoint and no client registration. Unauthenticated calls are " +
    "answered 401."
  );
}

/** The MCP server identity a client would read off a successful handshake. */
export interface ServerCardServerInfo {
  readonly name: string;
  readonly version: string;
}

/** One tool, shaped exactly like an entry in a `tools/list` result. */
export interface ServerCardTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** The card's authentication disclosure. `schemes` uses the standard api-key scheme name. */
export interface ServerCardAuthentication {
  readonly required: boolean;
  readonly schemes: readonly string[];
  readonly description: string;
}

/** The served document. */
export interface ServerCard {
  readonly serverInfo: ServerCardServerInfo;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly authentication: ServerCardAuthentication;
  readonly tools: readonly ServerCardTool[];
}

/** What the card is built FROM: the live MCP identity, capabilities and tool registry. */
export interface ServerCardInput {
  readonly serverInfo: ServerCardServerInfo;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly tools: readonly RegisteredTool[];
  /**
   * The personal-URL template to advertise, e.g. `https://mcp.seogrep.com/mcp/{key}`. Injected
   * rather than imported so this module stays pure: decision D28 makes the URL shape env-driven
   * (`MCP_URL_TEMPLATE`), and the composition root resolves it through the SAME helper the
   * dashboard uses — so a template change reaches the public card and the dashboard together.
   */
  readonly mcpUrlTemplate: string;
}

/**
 * Build the card. A PURE projection — no I/O, no environment, no clock — so the caller can
 * build it once at app construction and serve the same frozen-in-practice object to every
 * request. The tool entries are mapped from the registry's own name/description/derived JSON
 * Schema, which is exactly what `tools/list` returns, so the two surfaces cannot disagree.
 */
export function buildServerCard(input: ServerCardInput): ServerCard {
  return {
    serverInfo: { name: input.serverInfo.name, version: input.serverInfo.version },
    capabilities: input.capabilities,
    authentication: {
      required: true,
      schemes: ["apiKey"],
      description: authenticationDescription(input.mcpUrlTemplate),
    },
    tools: input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputJsonSchema,
    })),
  };
}
