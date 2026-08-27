import { JSDOM } from "jsdom";
import type { DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardHtml } from "./card.ts";

/**
 * The card, EXECUTED. Görev 3's pins read the template as text, and a text pin stays green while
 * the drawing code is broken — the exact shape of signed lesson 12. Here the document is loaded,
 * its script runs, a real host message is delivered, and the DOM is measured.
 *
 * ISOLATION: each test gets its OWN `new JSDOM(...)` instance rather than sharing vitest's
 * ambient jsdom environment. `document.open()` only clears child nodes (jsdom 26.1.0,
 * Document-impl.js) — it does NOT remove event listeners a previous mount registered. Reusing one
 * ambient `window` across seven tests would leave up to seven live `message` listeners on it by
 * the last test, and a bug that only shows up as "extra rows from an earlier mount" would read as
 * a different failure than the one it actually is. No `// @vitest-environment jsdom` pragma is
 * used for this reason: nothing in this file touches an ambient DOM global.
 *
 * TIMERS: fake timers are installed for every test (below) because the script schedules
 * `setTimeout(announce, 400)` and `setTimeout(reportSize, 0)` on every mount. Without controlling
 * them, those timers fire at real wall-clock time during the suite and are silently irrelevant
 * only because jsdom's `scrollHeight` happens to be 0 — that is an accident of the test
 * environment, not a property this suite has verified.
 *
 * CREDIT WHERE DUE: the `typeof ResizeObserver === "function"` and `document.fonts && …` guards
 * in runtime.ts ARE genuinely pinned by this file, just not by any single assertion. jsdom has
 * neither API, so removing either guard throws at script-load time inside every mount and takes
 * tests 2 through 7 down together (test 1 also fails, since it mounts too) — six or seven
 * simultaneous failures with no assertion pointing at the guard. A future reader who sees that and
 * "cleans up" the guards would be reading the correct effect as the wrong cause.
 */
function mountCard(beforeParse?: (window: DOMWindow) => void): JSDOM {
  return new JSDOM(cardHtml(), { runScripts: "dangerously", beforeParse });
}

/** Deliver one JSON-RPC message the way the host does, to one mounted instance. */
function fromHost(window: DOMWindow, message: unknown): void {
  window.dispatchEvent(new window.MessageEvent("message", { data: message }));
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the card draws what the host sends", () => {
  it("shows the waiting state before any message", () => {
    const { window } = mountCard();
    expect(window.document.getElementById("sg-badge")?.textContent).toBe("waiting");
    expect(window.document.getElementById("sg-value")?.textContent).toBe("—");
  });

  it("draws the headline figure, unit and badge from the card model", () => {
    const { window } = mountCard();
    fromHost(window, { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT });
    expect(window.document.getElementById("sg-value")?.textContent).toBe("4519");
    expect(window.document.getElementById("sg-unit")?.textContent).toBe("credits");
    expect(window.document.getElementById("sg-badge")?.textContent).toBe("Paid");
    expect(window.document.getElementById("sg-title")?.textContent).toBe("Credit balance");
  });

  it("draws one row per fact", () => {
    const { window } = mountCard();
    fromHost(window, { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT });
    const rows = window.document.querySelectorAll("#sg-facts tr");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector("th")?.textContent).toBe("Vendor tools");
    expect(rows[0]?.querySelector("td")?.textContent).toBe("Unlocked");
  });

  /**
   * A kind this slice cannot draw must leave the TEXT visible rather than paint an empty frame:
   * an empty card reads as a broken product, while the sentence is the whole answer anyway.
   *
   * Fix round 1 (CRITICAL 1): the original version of this test asserted only `sg-note`, which
   * `runtime.ts` writes IDENTICALLY on the fallback path (line 116) and the metric path (line
   * 121). Deleting the entire fallback guard (`runtime.ts:109-119`) left `sg-note` correct while
   * `sg-badge` stayed "live" and the metric slots stayed empty — green test, broken card. Now the
   * badge and value are asserted too, so that deletion is caught here.
   */
  it("falls back to the text answer for a kind it cannot draw", () => {
    const { window } = mountCard();
    fromHost(window, {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { content: [], structuredContent: { summary: "the whole answer", card: { kind: "list" } } },
    });
    expect(window.document.getElementById("sg-note")?.textContent).toBe("the whole answer");
    expect(window.document.getElementById("sg-badge")?.textContent).toBe("text");
    expect(window.document.getElementById("sg-value")?.textContent).toBe("—");
  });

  /**
   * Fix round 1 (CRITICAL 1, second half): the reset lines in the fallback branch
   * (`runtime.ts:110-115` — title, value, unit, badge, facts cleared) and the fact that the
   * `message` listener is NOT removed after the first delivery (IMPORTANT 1 mutation (b)) are only
   * exercised by delivering TWO results to the SAME mounted document. A metric result draws a
   * title/value/facts; a following non-metric result must clear all three, not merely fail to add
   * to them.
   */
  it("clears a previous metric's title, value and facts when a later result has no drawable card", () => {
    const { window } = mountCard();
    fromHost(window, { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT });
    expect(window.document.getElementById("sg-value")?.textContent).toBe("4519");

    fromHost(window, {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { content: [], structuredContent: { summary: "the whole answer", card: { kind: "list" } } },
    });
    expect(window.document.getElementById("sg-title")?.textContent).toBe("");
    expect(window.document.getElementById("sg-value")?.textContent).toBe("—");
    expect(window.document.querySelectorAll("#sg-facts tr")).toHaveLength(0);
    expect(window.document.getElementById("sg-note")?.textContent).toBe("the whole answer");
  });

  it("switches to the dark palette when the host says dark", () => {
    const { window } = mountCard();
    fromHost(window, {
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark" },
    });
    expect(window.document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  /**
   * The other side of that axis (signed lesson 14): a host that says light must NOT get the dark
   * attribute. Without this, a runtime that stamped "dark" unconditionally would pass the case
   * above and paint every light-mode reader a dark card.
   */
  it("stays light when the host says light", () => {
    const { window } = mountCard();
    fromHost(window, {
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "light" },
    });
    expect(window.document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  /**
   * Fix round 1 (IMPORTANT 1): the original second key, `"not-a-variable"`, is a tautology —
   * cssstyle 4.6.0 (jsdom's CSSStyleDeclaration implementation) returns early for ANY property
   * name that is neither a custom property (`--*`) nor a CSS property it recognises, so
   * `setProperty("not-a-variable", "x")` is a no-op regardless of whether `runtime.ts`'s own
   * `indexOf("--") === 0` filter (line 45) runs at all. `"color"` is a real CSS property cssstyle
   * DOES accept, so it actually exercises the filter.
   */
  it("applies host CSS variables verbatim without naming one", () => {
    const { window } = mountCard();
    fromHost(window, {
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { styles: { variables: { "--host-bg": "#123456", color: "red" } } },
    });
    expect(window.document.documentElement.style.getPropertyValue("--host-bg")).toBe("#123456");
    expect(window.document.documentElement.style.getPropertyValue("color")).toBe("");
  });

  /**
   * Fix round 1, new test (a): nothing above ever left a host silent. In production, against a
   * host that never answers `ui/initialize` and never pushes a tool-result either, the fallback
   * timer at `runtime.ts:145` (`setTimeout(announce, 400)`) is the ONLY thing that still
   * announces initialized — without it the view sits uninitialized forever. Deleting that timer
   * left every prior test green because every prior test explicitly delivers a message.
   *
   * TWO non-obvious things had to be worked out to make this assertion actually mean what it
   * says, both discovered by watching this test stay GREEN against runtime.ts with the timer line
   * physically deleted from disk — the exact failure mode this whole task exists to catch:
   *
   * 1. SELF-LOOP: `window.parent === window` at jsdom top level, so the card's own OUTGOING
   *    `ui/initialize` request is a postMessage FROM the window TO ITSELF. If the spy below calls
   *    through to jsdom's real `postMessage` (as an earlier draft of this test did), jsdom
   *    delivers that message back as an incoming `message` event with `data.id === 1` — which
   *    `runtime.ts:128` treats exactly like a genuine host response and calls `announce()`
   *    immediately (measured arrival: ~25ms), independent of whether the 400ms timer exists at
   *    all. The spy here does NOT call through to the real implementation, specifically to break
   *    that loop and isolate the timer as the only remaining path to an "initialized" message.
   * 2. FAKE TIMERS DON'T REACH THIS WINDOW: `vi.useFakeTimers()` (installed in `beforeEach` for
   *    every other test in this file) does not control `setTimeout` calls made BY SCRIPT RUNNING
   *    INSIDE a `runScripts: "dangerously"` JSDOM instance — confirmed empirically: with the
   *    timer intact and fake timers advanced past 400ms, no "initialized" message appeared at
   *    all. This test switches to real timers for itself and really waits.
   */
  it("announces initialized via the fallback timer when the host never responds", async () => {
    vi.useRealTimers();
    const sent: Array<{ method?: string }> = [];
    mountCard((win) => {
      // Swallow rather than forward to the real implementation — see note 1 above.
      win.postMessage = ((message: unknown) => {
        sent.push(message as { method?: string });
      }) as typeof win.postMessage;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sent.some((message) => message.method === "ui/notifications/initialized")).toBe(true);
  });

  /**
   * Fix round 1, new test (b): adding `{ once: true }` to the `message` listener in `runtime.ts`
   * would make every test above still pass, because every one of them delivers exactly ONE
   * message. In production the host's own `ui/initialize` response is message #1 — consuming the
   * listener there means the card never draws a single tool-result. Delivering a theme change and
   * then a tool-result to the SAME document proves the listener is still live for the second one.
   */
  it("keeps listening after the first message so a second host message still takes effect", () => {
    const { window } = mountCard();
    fromHost(window, {
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "dark" },
    });
    fromHost(window, { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: RESULT });
    expect(window.document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.document.getElementById("sg-value")?.textContent).toBe("4519");
  });
});
