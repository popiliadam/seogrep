import { mcpUrlFor, mcpUrlTemplate } from "@pseo/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { documentedToolNames, toolPageCount } from "../../lib/tool-surface";
import Page, { FEATURED_TOOL_NAMES } from "./page";

describe("landing page", () => {
  it("renders the brand h1 without placeholder text", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("grep your site for SEO issues.");
  });

  it("labels the chat demo as illustrative", () => {
    render(<Page />);
    expect(screen.getByText(/illustrative example — sample site, sample numbers/i)).toBeDefined();
  });

  // Replaces "has the waitlist section anchor". The gate is gone, so what has to hold now is
  // that the page actually offers a way IN — both CTAs land on /signup, and no dead #waitlist
  // anchor survives to scroll a visitor to nothing.
  it("routes both calls to action to /signup", () => {
    render(<Page />);
    const cta = screen.getAllByRole("link", { name: /get started free/i });
    expect(cta.length).toBe(2);
    for (const link of cta) expect(link.getAttribute("href")).toBe("/signup");
  });

  it("leaves no waitlist anchor behind", () => {
    render(<Page />);
    expect(document.getElementById("waitlist")).toBeNull();
  });

  it("mentions the real trial terms only", () => {
    render(<Page />);
    expect(screen.getByText(/200 credits, no card required/i)).toBeDefined();
  });

  // L-09: this line read "Free trial AT LAUNCH", which checkout going live made false — the trial
  // is grantable today. Signup is now open self-serve, so the line is finally unqualified: there
  // is no gate left between reading it and claiming it.
  it("does not defer the trial to a future launch", () => {
    render(<Page />);
    expect(screen.getByText(/200 credits, no card required/i).textContent).not.toMatch(/at launch/i);
  });

  /**
   * M-04: the hero showed `https://mcp.seogrep.com/u/<key>/mcp`. The address the server actually
   * routes, and the dashboard actually renders, is `https://mcp.seogrep.com/mcp/{key}` — so the
   * first thing a new visitor was invited to copy could not connect to anything.
   *
   * ASSERTED AGAINST THE TEMPLATE, NOT AGAINST A SECOND LITERAL. Writing the correct URL out here
   * would re-create the bug one directory over: two hardcoded addresses that agree today and drift
   * the day MCP_URL_TEMPLATE moves. Comparing the RENDER to mcpUrlFor() means this test follows the
   * template wherever it goes, and fails both for a literal that is wrong and for a literal that
   * happens to be right today.
   */
  it("shows the personal MCP URL the server really routes (M-04)", () => {
    render(<Page />);
    const expected = mcpUrlFor("your-key", mcpUrlTemplate());
    const shown = screen.getByText((_, element) => element?.textContent === expected, {
      selector: "span",
    });
    expect(shown).toBeDefined();
    // And the shape that shipped is gone, named explicitly so a revert cannot pass quietly.
    expect(document.body.textContent).not.toContain("/u/your-key/mcp");
  });

  /**
   * L-05: the grid named 16 tools against a 38-tool server, and every paid DataForSEO family was
   * missing — a visitor could not learn from this page that backlink, competitor, ranking or AI
   * visibility analysis exists at all.
   *
   * The fix is NOT "list all of them": a landing page curates. So the two properties that make a
   * curated list honest are what get asserted — no invented tool (NEVER #7), and a total that is
   * derived rather than typed.
   */
  it("names only tools that really exist (NEVER #7)", () => {
    const documented = new Set(documentedToolNames());
    expect(FEATURED_TOOL_NAMES.length).toBeGreaterThan(0);
    for (const tool of FEATURED_TOOL_NAMES) expect([...documented]).toContain(tool);
  });

  it("shows the paid families the page used to hide entirely", () => {
    // Named one by one rather than by count: "at least N tools" would go green again if the
    // backlink family were dropped and something cheap added in its place.
    for (const tool of ["compare_competitors", "analyze_backlinks", "ai_visibility", "ranked_keywords"]) {
      expect(FEATURED_TOOL_NAMES).toContain(tool);
    }
  });

  it("links to the full reference with a DERIVED tool count, not a typed one", () => {
    render(<Page />);
    const link = screen.getByRole("link", { name: new RegExp(`all ${toolPageCount()} tools`, "i") });
    expect(link.getAttribute("href")).toBe("/docs/tools-reference");
    // The stale number this finding is about must not reappear anywhere on the page.
    expect(document.body.textContent).not.toMatch(/all 16 tools/i);
  });

  it("emits valid SoftwareApplication JSON-LD (audit G2: was 0/42 pages)", () => {
    const { container } = render(<Page />);
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const blocks = scripts.map((s) => JSON.parse(s.textContent ?? "{}"));
    const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
    expect(app, "SoftwareApplication JSON-LD present").toBeDefined();
    expect(app["@context"]).toBe("https://schema.org");
    expect(app.name).toBe("SeoGrep");
  });
});
