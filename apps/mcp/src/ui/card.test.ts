import { describe, expect, it } from "vitest";
import { CARD_URI, MCP_APP_MIME, UI_RESOURCES, cardHtml } from "./card.ts";

describe("the shared card template is self-contained", () => {
  const html = cardHtml();

  it("references no external origin at all", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\/\/[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it("fetches nothing at runtime", () => {
    for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "import(", "importScripts"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("has no clickable surface — the card is display only", () => {
    expect(html).not.toMatch(/<button|<a\s|onclick=/i);
  });

  it("says it is waiting before any data arrives", () => {
    expect(html).toMatch(/id="sg-badge"[^>]*>waiting</);
  });

  it("completes the spec's handshake and listens for results", () => {
    for (const method of [
      "ui/initialize",
      "ui/notifications/initialized",
      "ui/notifications/tool-result",
      "ui/notifications/host-context-changed",
      "ui/notifications/size-changed",
    ]) {
      expect(html).toContain(method);
    }
  });

  it("is advertised under the profiled HTML type", () => {
    expect(MCP_APP_MIME).toBe("text/html;profile=mcp-app");
    expect(CARD_URI).toBe("ui://seogrep/card");
    expect(UI_RESOURCES).toHaveLength(1);
    expect(UI_RESOURCES[0]?.uri).toBe(CARD_URI);
  });
});
