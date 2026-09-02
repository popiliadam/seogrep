import { describe, expect, it } from "vitest";
import { parseRobots } from "./robots.ts";

// Unit spec for the pure robots.txt parser: group selection (SeoGrepBot beats *),
// Allow/Disallow longest-match, `*`/`$` wildcards, Crawl-delay, comment tolerance.
describe("parseRobots — group selection", () => {
  it("allows everything when the file is empty", () => {
    const rules = parseRobots("");
    expect(rules.isAllowed("/anything")).toBe(true);
    expect(rules.crawlDelayMs).toBe(0);
  });

  it("applies the '*' group when there is no bot-specific group", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private\n");
    expect(rules.isAllowed("/private")).toBe(false);
    expect(rules.isAllowed("/private/x")).toBe(false);
    expect(rules.isAllowed("/public")).toBe(true);
  });

  it("prefers the SeoGrepBot group over '*' (case-insensitive)", () => {
    const txt = [
      "User-agent: *",
      "Disallow: /",
      "",
      "user-agent: seogrepbot",
      "Disallow: /admin",
    ].join("\n");
    const rules = parseRobots(txt);
    // The '*' blanket Disallow: / must be ignored in favour of the specific group.
    expect(rules.isAllowed("/")).toBe(true);
    expect(rules.isAllowed("/blog")).toBe(true);
    expect(rules.isAllowed("/admin")).toBe(false);
  });

  it("shares rules across grouped user-agents", () => {
    const txt = ["User-agent: googlebot", "User-agent: *", "Disallow: /shared", ""].join("\n");
    expect(parseRobots(txt).isAllowed("/shared")).toBe(false);
  });
});

describe("parseRobots — matching semantics", () => {
  it("treats an empty Disallow value as 'allow all'", () => {
    const rules = parseRobots("User-agent: *\nDisallow:\n");
    expect(rules.isAllowed("/anything")).toBe(true);
  });

  it("lets a longer Allow override a shorter Disallow (tie goes to Allow)", () => {
    const txt = ["User-agent: *", "Disallow: /docs", "Allow: /docs/public"].join("\n");
    const rules = parseRobots(txt);
    expect(rules.isAllowed("/docs/secret")).toBe(false);
    expect(rules.isAllowed("/docs/public/page")).toBe(true);
  });

  /**
   * THE TIE ITSELF — R-3.5 / RFC 9309 §2.2.2, "the least restrictive rule wins".
   *
   * The spec above is TITLED "(tie goes to Allow)" and measures no tie: `/docs` against
   * `/docs/public` is a longer Allow, not an equal-length one. MEASURED 2026-09-02: flipping
   * `allow >= disallow` to `allow > disallow` in robots.ts — which hands an exact-length
   * collision to Disallow — left 164/164 crawler tests green. A site owner's explicit
   * `Allow: /a` beside `Disallow: /a` would then be silently ignored and the customer would pay
   * 20 credits for a smaller crawl than the one they permitted.
   *
   * BOTH ORDERS are pinned. Allow and Disallow are collected into two independent lists and
   * compared by LENGTH, so directive order must not matter — and a spec that only ever wrote
   * Disallow first would leave the other half of that claim unmeasured.
   */
  it("resolves an EQUAL-LENGTH Allow/Disallow collision in favour of Allow", () => {
    const disallowFirst = parseRobots(["User-agent: *", "Disallow: /a", "Allow: /a"].join("\n"));
    expect(disallowFirst.isAllowed("/a")).toBe(true);
    expect(disallowFirst.isAllowed("/a/deep")).toBe(true);

    const allowFirst = parseRobots(["User-agent: *", "Allow: /a", "Disallow: /a"].join("\n"));
    expect(allowFirst.isAllowed("/a")).toBe(true);
    expect(allowFirst.isAllowed("/a/deep")).toBe(true);
  });

  /**
   * The CONTROL for the tie above: "least restrictive" is not "always allow". A strictly LONGER
   * Disallow still wins, so an implementation that resolved every collision to Allow — the
   * opposite over-correction — fails here.
   */
  it("still lets a strictly LONGER Disallow beat a shorter Allow", () => {
    const rules = parseRobots(
      ["User-agent: *", "Allow: /docs", "Disallow: /docs/secret"].join("\n"),
    );
    expect(rules.isAllowed("/docs/secret")).toBe(false);
    expect(rules.isAllowed("/docs/public")).toBe(true);
  });

  it("honours '*' wildcards and '$' end-anchors", () => {
    const txt = ["User-agent: *", "Disallow: /*.pdf$"].join("\n");
    const rules = parseRobots(txt);
    expect(rules.isAllowed("/files/report.pdf")).toBe(false);
    expect(rules.isAllowed("/files/report.pdf?v=1")).toBe(true); // $ anchors the end
    expect(rules.isAllowed("/files/report.html")).toBe(true);
  });

  it("ignores comments and blank lines", () => {
    const txt = ["# a comment", "", "User-agent: *   # inline", "Disallow: /x  # trailing"].join("\n");
    expect(parseRobots(txt).isAllowed("/x")).toBe(false);
  });
});

describe("parseRobots — crawl delay", () => {
  it("reads Crawl-delay (seconds) into milliseconds, uncapped", () => {
    const rules = parseRobots("User-agent: *\nCrawl-delay: 2\n");
    expect(rules.crawlDelayMs).toBe(2000);
  });

  it("reads the bot-specific Crawl-delay when present", () => {
    const txt = [
      "User-agent: *",
      "Crawl-delay: 10",
      "",
      "User-agent: seogrepbot",
      "Crawl-delay: 1",
    ].join("\n");
    expect(parseRobots(txt).crawlDelayMs).toBe(1000);
  });
});
