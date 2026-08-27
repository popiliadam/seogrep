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
 * `setTimeout(announce, 400)` and `setTimeout(reportSize, 0)` on every mount, AND `vi.useFakeTimers()`
 * genuinely reaches those calls — jsdom resolves `window.setTimeout` to the outer Node realm's
 * `setTimeout` (`jsdom/lib/jsdom/browser/Window.js`), which is exactly what vitest patches. That is
 * WHY installing them here works: it holds all nine other mounts' timers inert (frozen, not
 * cancelled) for the length of the suite, rather than leaving them pending against real wall-clock
 * time and firing on stale windows in the background later. Measured, not assumed — see the note on
 * test 9 below, which has to opt OUT of that control on purpose to get a real 400ms wait.
 *
 * CREDIT WHERE DUE, corrected (fix round 2 — an earlier version of this comment reported an
 * unmeasured claim as fact): the `typeof ResizeObserver === "function"` guard IS pinned by this
 * file, but not the way the previous note said. The `message` listener is registered at
 * `runtime.ts:125`, BEFORE the guard at `runtime.ts:137` — so removing the guard and letting `new
 * ResizeObserver(...)` throw at script-load time does NOT take the listener down with it. Measured
 * directly: with the guard removed, EXACTLY ONE test fails — #9 (the fallback-timer test) — because
 * the throw aborts the rest of the top-level script, which is where `setTimeout(announce, 400)`
 * lives (`runtime.ts:144-146`, past the guard). Tests 2 through 8 and 10, which only dispatch
 * events at the already-live listener, still pass. #9's failure message
 * (`expected false to be true`) names the fallback timer, not the guard — which is exactly why this
 * note is worth having: a reader chasing that one failure would have no reason to suspect a
 * ResizeObserver guard two tests away, unless told.
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
  /**
   * Fix round 2 (coordinator note): this test constrains `card.ts`'s STATIC markup — "waiting"
   * and "—" are the literal initial values in the template, and no message is delivered here, so
   * no `runtime.ts` drawing function ever runs. It is not runtime.ts coverage; it is a check that
   * the waiting state the runtime relies on finding is actually there before it draws anything.
   */
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
    // CONTROL, not a pin (fix round 2): a fresh mount already shows "—" from card.ts's static
    // markup (see the note on the first test above), and this test never draws a metric first —
    // so deleting runtime.ts:111's own `text("sg-value", "—")` leaves this line green too.
    // Measured directly. The real pin on that reset line is the sequence test below, which draws
    // a metric ("4519") BEFORE the fallback, so the value has to actually change back.
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
   * 2. THIS TEST OPTS OUT OF FAKE TIMERS ON PURPOSE (fix round 2 — corrected: an earlier version
   *    of this note claimed `vi.useFakeTimers()` cannot reach this window's `setTimeout` at all;
   *    that was measured wrong. It DOES reach it — `beforeEach`'s fake timers are exactly what
   *    hold the other nine mounts' timers inert for the length of the suite, see the file
   *    docblock above.) Using the fake clock here would make this test just as fast, but it would
   *    also mean the 400ms wait is happening because a shared, easy-to-remove `beforeEach` call
   *    still applies to this test — an accident of suite-wide setup, not a property of THIS test.
   *    Calling `vi.useRealTimers()` here makes the real 400ms fallback an explicit, local decision
   *    that survives someone later scoping or deleting the shared fake-timer install.
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
