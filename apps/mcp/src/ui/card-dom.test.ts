// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cardHtml } from "./card.ts";

/**
 * The card, EXECUTED. Görev 3's pins read the template as text, and a text pin stays green while
 * the drawing code is broken — the exact shape of signed lesson 12. Here the document is loaded,
 * its script runs, a real host message is delivered, and the DOM is measured.
 */
function mountCard(): Document {
  document.open();
  document.write(cardHtml());
  document.close();
  return document;
}

/** Deliver one JSON-RPC message the way the host does. */
function fromHost(message: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}

const RESULT = {
  content: [{ type: "text", text: "Credit balance: 4519 credits. …" }],
  structuredContent: {
    summary: "Credit balance: 4519 credits. …",
    card: {
      kind: "metric",
      title: "Credit balance",
      value: "4519",
      unit: "credits",
      badge: "Paid",
      facts: [{ label: "Vendor tools", value: "Unlocked" }],
    },
  },
};

describe("the card draws what the host sends", () => {
  it("shows the waiting state before any message", () => {
    const doc = mountCard();
    expect(doc.getElementById("sg-badge")?.textContent).toBe("waiting");
    expect(doc.getElementById("sg-value")?.textContent).toBe("—");
  });

  it("draws the headline figure, unit and badge from the card model", () => {
    const doc = mountCard();
    fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT });
    expect(doc.getElementById("sg-value")?.textContent).toBe("4519");
    expect(doc.getElementById("sg-unit")?.textContent).toBe("credits");
    expect(doc.getElementById("sg-badge")?.textContent).toBe("Paid");
    expect(doc.getElementById("sg-title")?.textContent).toBe("Credit balance");
  });

  it("draws one row per fact", () => {
    const doc = mountCard();
    fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT });
    const rows = doc.querySelectorAll("#sg-facts tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector("th")?.textContent).toBe("Vendor tools");
    expect(rows[0]?.querySelector("td")?.textContent).toBe("Unlocked");
  });

  /**
   * A kind this slice cannot draw must leave the TEXT visible rather than paint an empty frame:
   * an empty card reads as a broken product, while the sentence is the whole answer anyway.
   */
  it("falls back to the text answer for a kind it cannot draw", () => {
    const doc = mountCard();
    fromHost({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { content: [], structuredContent: { summary: "the whole answer", card: { kind: "list" } } },
    });
    expect(doc.getElementById("sg-note")?.textContent).toBe("the whole answer");
  });

  it("switches to the dark palette when the host says dark", () => {
    const doc = mountCard();
    fromHost({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark" },
    });
    expect(doc.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  /**
   * The other side of that axis (signed lesson 14): a host that says light must NOT get the dark
   * attribute. Without this, a runtime that stamped "dark" unconditionally would pass the case
   * above and paint every light-mode reader a dark card.
   */
  it("stays light when the host says light", () => {
    const doc = mountCard();
    fromHost({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "light" },
    });
    expect(doc.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("applies host CSS variables verbatim without naming one", () => {
    const doc = mountCard();
    fromHost({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { styles: { variables: { "--host-bg": "#123456", "not-a-variable": "x" } } },
    });
    expect(doc.documentElement.style.getPropertyValue("--host-bg")).toBe("#123456");
    expect(doc.documentElement.style.getPropertyValue("not-a-variable")).toBe("");
  });
});
