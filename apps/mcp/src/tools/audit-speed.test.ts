import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  MAX_SPEED_URLS,
  createMockSpeedPort,
  disabledSpeedPort,
  type PageSpeedMeasurement,
  type SpeedPort,
} from "../dfs/lighthouse.ts";
import {
  formatSpeedAudit,
  makeAuditSpeedTool,
  normalizeSpeedUrl,
  normalizeSpeedUrls,
} from "./audit-speed.ts";
import lighthouseFixture from "../dfs/fixtures/lighthouse.json";

/**
 * Fast-lane (DB-less) proofs for audit_speed. The credit LEDGER behaviour (mock -> reserve+commit
 * at 15; disabled / DataForSEO error -> no charge) is proven against the real stack in
 * audit-speed.db.test.ts. Here we prove: the pure renderer (whose whole job is to never state a
 * measurement that did not happen), the URL normalizer, the tool metadata, and — critically —
 * that every free pre-reserve gate returns WITHOUT touching credits.
 *
 * A tool whose port is never reached charges nothing by construction: `port.fetchPageSpeed` on the
 * spy ports below throws if it is called, so a gate that fired late would fail loudly rather than
 * pass quietly.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** A port that must NEVER be reached — any call is a gate that fired too late. */
const forbiddenPort: SpeedPort = {
  enabled: true,
  fetchPageSpeed: async () => {
    throw new Error("the port was reached, so a free gate did not fire first");
  },
};

function page(overrides: Partial<PageSpeedMeasurement> = {}): PageSpeedMeasurement {
  return {
    requested_url: "https://slowshop.org/",
    final_url: null,
    fetch_time: "2026-08-17T09:12:44.831Z",
    lighthouse_version: "11.4.0",
    performance_score: 0.41,
    metrics: [
      {
        id: "largest-contentful-paint",
        label: "Largest Contentful Paint",
        display: "6.1 s",
        numeric: 6104.2,
        unit: "ms",
      },
    ],
    opportunities: [
      { id: "render-blocking-resources", title: "Eliminate render-blocking resources", savings_ms: 1840 },
    ],
    ...overrides,
  };
}

describe("normalizeSpeedUrl", () => {
  it("keeps the path — a page URL is the whole point here", () => {
    expect(normalizeSpeedUrl("https://slowshop.org/pricing?plan=pro")).toEqual({
      ok: true,
      url: "https://slowshop.org/pricing?plan=pro",
    });
  });

  it("reads a bare domain as its https home page", () => {
    expect(normalizeSpeedUrl("slowshop.org")).toEqual({ ok: true, url: "https://slowshop.org/" });
  });

  it("keeps http, because plenty of pages worth measuring are still on it", () => {
    expect(normalizeSpeedUrl("http://slowshop.org/")).toEqual({ ok: true, url: "http://slowshop.org/" });
  });

  /**
   * The scheme gate, varied on the axis that actually differs: whether the scheme carries an
   * AUTHORITY. `file://` and `ftp://` do; `javascript:`, `data:` and `mailto:` do not, and the
   * schemeless ones are the dangerous half — prepending `https://` to `mailto:user@slowshop.org`
   * produces a perfectly valid `https://slowshop.org/`, i.e. a scheme we refuse would quietly be
   * measured as someone's domain. Every one of them must be refused by the SAME rule, with the
   * same sentence, so the assertion is on the message and not merely on `ok === false`.
   */
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<h1>x</h1>",
    "ftp://slowshop.org/x",
    "mailto:user@slowshop.org",
  ])("refuses %s — only http(s) pages can be measured", (raw) => {
    const result = normalizeSpeedUrl(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/only http and https/i);
  });

  /**
   * …and the rule that makes that gate safe to apply: a host:PORT is not a scheme. Without the
   * digit lookahead in URL_SCHEME_RE this ordinary URL reads as the scheme "slowshop.org" and is
   * refused.
   */
  it("does not mistake a port for a scheme", () => {
    expect(normalizeSpeedUrl("slowshop.org:8080/pricing")).toEqual({
      ok: true,
      url: "https://slowshop.org:8080/pricing",
    });
  });

  /**
   * The public-hostname gate is the shared one (@pseo/core net/hostname), so an internal name is
   * refused with the same word every other tool uses — and, more to the point, is never handed to
   * a third party to fetch on our behalf.
   */
  it.each(["http://localhost:3000/", "https://metadata.google.internal/", "https://box.local/", "https://a.test/"])(
    "refuses the non-public host %s",
    (raw) => {
      expect(normalizeSpeedUrl(raw).ok).toBe(false);
    },
  );

  it("refuses an empty value with a sentence, not a crash", () => {
    const result = normalizeSpeedUrl("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/required/i);
  });
});

describe("normalizeSpeedUrls", () => {
  it("measures the same page once, however it was written", () => {
    expect(normalizeSpeedUrls(["slowshop.org", "https://slowshop.org/", "slowshop.org/pricing"])).toEqual({
      ok: true,
      urls: ["https://slowshop.org/", "https://slowshop.org/pricing"],
    });
  });

  it("the FIRST invalid URL rejects the whole call", () => {
    const result = normalizeSpeedUrls(["https://slowshop.org/", "http://localhost/"]);
    expect(result.ok).toBe(false);
  });
});

describe("formatSpeedAudit", () => {
  it("says these are lab measurements before any number is read", () => {
    const text = formatSpeedAudit([page()]);
    expect(text).toMatch(/lab measurements/i);
    expect(text).toMatch(/not field data from real visitors/i);
  });

  it("renders the score on Lighthouse's own 0–100 presentation", () => {
    expect(formatSpeedAudit([page()])).toContain("Performance score: 41 / 100");
  });

  it("prints the vendor's own formatted metric value", () => {
    expect(formatSpeedAudit([page()])).toContain("Largest Contentful Paint: 6.1 s");
  });

  it("falls back to the raw number WITH its unit when the vendor sent no formatted value", () => {
    const text = formatSpeedAudit([
      page({
        metrics: [
          { id: "interactive", label: "Time to Interactive", display: null, numeric: 9412.7, unit: "ms" },
        ],
      }),
    ]);
    expect(text).toContain("Time to Interactive: 9,413 ms");
  });

  /**
   * The renderer's own half of the value-less rule. The parser already drops such a metric, so
   * this can only be reached by a caller building one — which is exactly why it is asserted here:
   * the one-line `?? 0` fallback that would satisfy the type system prints "0 ms" for something
   * nobody measured, and on a speed report that is the best-looking possible lie.
   */
  it("prints NO line for a metric carrying neither a formatted nor a numeric value", () => {
    const text = formatSpeedAudit([
      page({
        metrics: [
          { id: "speed-index", label: "Speed Index", display: null, numeric: null, unit: "ms" },
        ],
        // Emptied so the `0 ms` assertion below measures the METRIC line and nothing else — the
        // default opportunity's "1,840 ms saved" contains "0 ms" and would satisfy it for free.
        opportunities: [],
      }),
    ]);
    expect(text).not.toMatch(/Speed Index/);
    expect(text).not.toMatch(/0 ms/);
  });

  it("prints a unitless metric without inventing a unit", () => {
    const text = formatSpeedAudit([
      page({
        metrics: [
          {
            id: "cumulative-layout-shift",
            label: "Cumulative Layout Shift",
            display: null,
            numeric: 0.19,
            unit: "",
          },
        ],
      }),
    ]);
    expect(text).toContain("Cumulative Layout Shift: 0.19");
    expect(text).not.toContain("0.19 ms");
  });

  /**
   * The rule the whole tool is written under, at the RENDERER end this time: an unmeasured axis
   * gets no line. A "Speed Index: 0 ms" would be the single most misleading thing this tool could
   * print, because on a speed report a zero reads as perfect.
   */
  it("prints NO line for a metric the vendor never returned", () => {
    const text = formatSpeedAudit([page({ metrics: [] })]);
    expect(text).not.toMatch(/Speed Index/);
    expect(text).not.toMatch(/: 0 ms/);
  });

  it("says in words that a page was not scored, rather than scoring it zero", () => {
    const text = formatSpeedAudit([page({ performance_score: null })]);
    expect(text).toMatch(/returned no score for this page/i);
    expect(text).not.toContain("0 / 100");
  });

  /**
   * The OTHER direction of the same axis, and the one a referee found unprotected: a page that
   * really scored 0 is a MEASURED catastrophe, and reporting it as "we have no score" hides the
   * worst finding this tool can produce.
   *
   * Measured, not assumed: with only the null-side spec above, changing `performance_score === null`
   * to `!page.performance_score` left ALL 1487 tests green. `=== null` is load-bearing precisely
   * because 0 is falsy AND meaningful, which is this tool's whole thesis — and a rule stated in
   * only one direction is a rule tested in only one direction.
   */
  it("prints a REAL zero score as a zero — 0 is a measurement, not a missing value", () => {
    const text = formatSpeedAudit([page({ performance_score: 0 })]);
    expect(text).toContain("Performance score: 0 / 100");
    expect(text).not.toMatch(/returned no score for this page/i);
  });

  /**
   * Same axis, metric side. A Total Blocking Time of 0 ms and a Cumulative Layout Shift of 0 are
   * the BEST results those metrics can have, so a `!metric.numeric` guard would silently drop the
   * lines belonging to the pages that are performing perfectly.
   */
  it("prints a REAL zero metric — the best possible result is still a result", () => {
    const text = formatSpeedAudit([
      page({
        metrics: [
          { id: "total-blocking-time", label: "Total Blocking Time", display: null, numeric: 0, unit: "ms" },
          {
            id: "cumulative-layout-shift",
            label: "Cumulative Layout Shift",
            display: null,
            numeric: 0,
            unit: "",
          },
        ],
        opportunities: [],
      }),
    ]);
    expect(text).toContain("Total Blocking Time: 0 ms");
    expect(text).toContain("Cumulative Layout Shift: 0");
  });

  it("prints no opportunities heading when there is nothing to suggest", () => {
    expect(formatSpeedAudit([page({ opportunities: [] })])).not.toMatch(/opportunit/i);
  });

  it("names the redirect only when the final URL DIFFERS from the one asked for", () => {
    expect(formatSpeedAudit([page({ final_url: "https://www.slowshop.org/" })])).toContain(
      "redirected to https://www.slowshop.org/",
    );
    expect(formatSpeedAudit([page({ final_url: "https://slowshop.org/" })])).not.toMatch(/redirected/);
  });

  it("omits the provenance line entirely when the vendor sent none of its parts", () => {
    const text = formatSpeedAudit([
      page({ fetch_time: null, lighthouse_version: null, final_url: null }),
    ]);
    expect(text).not.toMatch(/measured undefined|Lighthouse null|\(\)/);
  });

  it("renders one block per page and counts them in the heading", () => {
    const text = formatSpeedAudit([page(), page({ requested_url: "https://slowshop.org/pricing" })]);
    expect(text).toContain("2 page(s) measured");
    expect(text).toContain("• https://slowshop.org/pricing");
  });
});

describe("audit_speed tool metadata", () => {
  const tool = makeAuditSpeedTool();

  it("is a self-settling synchronous handler charge, not a worker job", () => {
    expect(tool.name).toBe("audit_speed");
    expect(tool.charge).toBe("handler");
  });

  /**
   * The cap is pinned to the LITERAL 5, not to MAX_SPEED_URLS.
   *
   * This was measured, not assumed: with every assertion written against the constant, raising
   * `MAX_SPEED_URLS` from 5 to 6 left the whole suite GREEN — the schema, the refusal test and
   * this pin all moved with it. The cap is part of the price the operator signed on 2026-08-17
   * ("15 credits, urls <= 5"), so it is a NEVER #6 number and has to fail loudly the way the
   * TOOL_COSTS table does. The refusal test below names 6 literally for the same reason.
   */
  it("caps a call at the SIGNED five URLs (NEVER #6 — the cap is part of the price)", () => {
    expect(MAX_SPEED_URLS).toBe(5);
    const urls = (tool.inputJsonSchema.properties as Record<string, { maxItems?: number; minItems?: number }>)
      .urls;
    expect(urls?.maxItems).toBe(5);
    expect(urls?.minItems).toBe(1);
  });

  it("states the cost, the paid-balance requirement and the free refusal", () => {
    expect(tool.description).toContain(`${TOOL_COSTS.audit_speed} credits`);
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
    // …and it does not claim to know which side of the DFS_LIVE switch this deployment is on.
    expect(tool.description).not.toMatch(/is (currently )?(turned )?off\b/i);
  });
});

describe("the free pre-reserve gates (NEVER #2 — a refusal touches no ledger)", () => {
  /**
   * The URL cap is enforced by the zod schema, so the registry refuses the call before the handler
   * runs at all. It is part of the SIGNED price (NEVER #6): the flat credit cost is quoted against
   * five pages, so a sixth would be a page the customer did not pay for.
   */
  it("refuses SIX URLs before the handler is entered — and accepts five", async () => {
    const tool = makeAuditSpeedTool({ port: forbiddenPort });
    const url = (index: number): string => `https://slowshop.org/p${index}`;
    // Six, written out: see the cap pin above for why this number is a literal.
    const tooMany = await tool.run(CTX, { urls: [0, 1, 2, 3, 4, 5].map(url) });
    expect(tooMany.isError).toBe(true);
    expect(tooMany.content[0]?.text).toMatch(/invalid input/i);
    // …and FIVE passes the schema, so this pin measures the CAP and not merely "long arrays are
    // refused". Proven with the disabled port, whose "not yet enabled" sentence can only be
    // reached from INSIDE the handler — i.e. the schema let five through.
    const atCap = await makeAuditSpeedTool({ port: disabledSpeedPort() }).run(CTX, {
      urls: [0, 1, 2, 3, 4].map(url),
    });
    expect(atCap.content[0]?.text).toMatch(/not yet enabled/i);
  });

  it("refuses an empty URL list", async () => {
    const tool = makeAuditSpeedTool({ port: forbiddenPort });
    const result = await tool.run(CTX, { urls: [] });
    expect(result.isError).toBe(true);
  });

  it("refuses a reserved-name URL before the port is ever consulted", async () => {
    const tool = makeAuditSpeedTool({ port: forbiddenPort });
    const result = await tool.run(CTX, {
      urls: ["https://slowshop.org/", "https://metadata.google.internal/"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a public domain/i);
  });

  it("refuses a single-label host (localhost) before the port is ever consulted", async () => {
    // A DIFFERENT axis from the reserved-TLD case above, and a different message: `localhost` has
    // no dot at all, so it fails the domain SHAPE check rather than the reserved-name check.
    const tool = makeAuditSpeedTool({ port: forbiddenPort });
    const result = await tool.run(CTX, { urls: ["http://localhost:8080/"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("refuses a non-http scheme before the port is ever consulted", async () => {
    const tool = makeAuditSpeedTool({ port: forbiddenPort });
    const result = await tool.run(CTX, { urls: ["javascript:alert(1)"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/http and https/i);
  });

  it("refuses cleanly — and free — while live DataForSEO access is off", async () => {
    const tool = makeAuditSpeedTool({ port: disabledSpeedPort() });
    const result = await tool.run(CTX, { urls: ["https://slowshop.org/"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    // NEVER #7: the refusal must not be softened into serving the fixture.
    expect(result.content[0]?.text).not.toMatch(/Performance score/);
  });

  /**
   * The gate ORDER, made visible: the live-disabled refusal is reached only when the URLs are
   * already valid, and an invalid URL is refused even while live data is ON. Both directions
   * matter — a tool that checked `enabled` first would tell a customer with a typo that the
   * feature is unavailable, and one that checked it last would reserve credits for a call it was
   * never going to make.
   */
  it("reports the URL problem, not the availability one, when both are true", async () => {
    const tool = makeAuditSpeedTool({ port: disabledSpeedPort() });
    const result = await tool.run(CTX, { urls: ["javascript:alert(1)"] });
    expect(result.content[0]?.text).toMatch(/http and https/i);
    expect(result.content[0]?.text).not.toMatch(/not yet enabled/i);
  });
});

describe("the serving path's shape (no ledger — that is audit-speed.db.test.ts)", () => {
  it("renders the fixture measurement the port returns", async () => {
    const pages = await createMockSpeedPort({ default: lighthouseFixture }).fetchPageSpeed([
      "https://slowshop.org/",
    ]);
    const text = formatSpeedAudit(pages);
    expect(text).toContain("• https://slowshop.org/");
    expect(text).toContain("Performance score: 41 / 100");
    expect(text).toContain("Largest Contentful Paint: 6.1 s");
    expect(text).toContain("Eliminate render-blocking resources — an estimated 1,840 ms saved");
    // The fixture omits speed-index and prices one opportunity at 0 — neither reaches the page.
    expect(text).not.toMatch(/Speed Index/);
    expect(text).not.toMatch(/efficient cache policy/);
  });
});
