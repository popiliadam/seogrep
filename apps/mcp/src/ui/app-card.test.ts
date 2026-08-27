import { describe, expect, it } from "vitest";
import { BALANCE_CARD_URI, MCP_APP_MIME, UI_RESOURCES, balanceCardHtml } from "./app-card.ts";

/**
 * The MCP Apps probe's own pins (SEP-1865). They are deliberately about the two things a probe
 * can get wrong in a way that WASTES the measurement rather than failing it:
 *
 *   1. the view reaching for the network — the host's default CSP blocks it, so the card would
 *      render un-styled and we would read "the theme does not survive" when the truth is "we
 *      asked for something the sandbox forbids";
 *   2. the text answer drifting — the whole point is that the text is untouched, and the smoke
 *      tour's record of all 38 tools rests on it.
 */
describe("the MCP Apps view is self-contained", () => {
  const html = balanceCardHtml();

  /**
   * Asserted as SHAPES, never as a list of hosts to avoid. A pin that named `cdn.jsdelivr.net`
   * would pass the day someone reached for a different CDN, which is the mistake this closes.
   */
  it("references no external origin at all", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\/\/[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it("fetches nothing at runtime", () => {
    for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "import(", "importScripts"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("names a fallback for every brand font, because no web font can load", () => {
    // The brand faces are Newsreader and IBM Plex Mono; inside the view neither exists.
    expect(html).toMatch(/Newsreader,\s*Georgia,\s*serif/);
    expect(html).toMatch(/"IBM Plex Mono",\s*"Courier New",\s*monospace/);
  });

  /**
   * The waiting state is the probe's INSTRUMENT, not decoration: without a word on screen before
   * data arrives, "the view never rendered" and "the view rendered and got no data" look
   * identical, and the probe answers a question nobody asked.
   */
  it("says it is waiting before any data arrives", () => {
    expect(html).toMatch(/id="state"[^>]*>waiting</);
  });

  it("listens for the spec's result notification and completes the handshake", () => {
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("ui/initialize");
    expect(html).toContain("ui/notifications/initialized");
  });

  it("is advertised under the profiled HTML type, not plain text/html", () => {
    expect(MCP_APP_MIME).toBe("text/html;profile=mcp-app");
    expect(UI_RESOURCES).toHaveLength(1);
    expect(UI_RESOURCES[0]?.uri).toBe(BALANCE_CARD_URI);
    expect(BALANCE_CARD_URI.startsWith("ui://")).toBe(true);
  });
});
