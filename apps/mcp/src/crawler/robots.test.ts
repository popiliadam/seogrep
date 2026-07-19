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
