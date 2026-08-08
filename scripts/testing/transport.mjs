// JSON-RPC 2.0 transport for the live SeoGrep MCP endpoint (Streamable HTTP).
//
// Deliberately a PORT, not a hardwired fetch: the whole harness talks to `call(method, params)`
// and nothing else, which is what lets --self-test exercise the ceiling, the resume filter and
// the outcome classifier without opening a socket. This mirrors how the product's own tools
// inject their I/O (deps.estimate in crawl-site.ts, deps.loadCrawl in audit-shared.ts).
//
// Measured 2026-08-09 against the live endpoint: `initialize` answers HTTP 200 with
// `content-type: application/json` and a plain JSON-RPC body — no SSE frames, no session
// header. The SSE branch below is kept anyway because the Accept header offers
// text/event-stream and a server is free to take it; a transport that only parses the shape
// it happened to see once is a transport that breaks on a deploy.

const HEADERS = Object.freeze({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
});

/** The name the live server reports. Asserted at startup so a wrong endpoint fails loudly. */
export const EXPECTED_SERVER_NAME = "seogrep-mcp";

/**
 * Parse a response body that may be plain JSON or an SSE stream. SSE `data:` lines are
 * concatenated in order, which is what the spec prescribes for a multi-line data field.
 * Returns null when nothing parses — the caller records that as a transport error rather
 * than guessing, because a body we cannot read is not a measurement.
 */
export function parseRpcBody(text, contentType = "") {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length === 0) return null;
  const looksSse = contentType.includes("text/event-stream") || trimmed.startsWith("event:");
  const payload = looksSse ? sseData(trimmed) : trimmed;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function sseData(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("");
}

/**
 * The live transport. Every call returns the SAME envelope shape whether it succeeded, was
 * refused, or never left the machine — the runner records outcomes, so a thrown exception
 * here would turn a recordable finding into a crashed run.
 */
export function makeHttpTransport(endpointUrl, fetchImpl = fetch) {
  let nextId = 1;
  return async function call(method, params) {
    const startedAt = Date.now();
    const request = JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params });
    let response;
    let text;
    try {
      response = await fetchImpl(endpointUrl, { method: "POST", headers: HEADERS, body: request });
      text = await response.text();
    } catch (error) {
      return {
        httpStatus: 0,
        body: null,
        transportError: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }
    const body = parseRpcBody(text, response.headers.get("content-type") ?? "");
    return {
      httpStatus: response.status,
      body,
      transportError:
        body === null ? `unparseable response body (HTTP ${response.status})` : null,
      durationMs: Date.now() - startedAt,
    };
  };
}

/** `initialize`, plus the identity assertion. Throws on anything that is not our server. */
export async function initializeSession(call, clientName) {
  const result = await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: clientName, version: "0.0.1" },
  });
  const name = result.body?.result?.serverInfo?.name;
  if (name !== EXPECTED_SERVER_NAME) {
    throw new Error(
      `initialize did not reach ${EXPECTED_SERVER_NAME} (HTTP ${result.httpStatus}, serverInfo.name=${String(name)})`,
    );
  }
  return result.body.result;
}

/** `tools/list` -> the live tool array. Throws when the list cannot be read at all. */
export async function listTools(call) {
  const result = await call("tools/list", {});
  const tools = result.body?.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`tools/list returned no tool array (HTTP ${result.httpStatus})`);
  }
  return tools;
}

/** One `tools/call`. The only method in this file that can ever cost credits. */
export function callTool(call, name, args) {
  return call("tools/call", { name, arguments: args });
}
