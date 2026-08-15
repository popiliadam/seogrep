import { describe, expect, it } from "vitest";
import { PROMPTS, getPrompt, listPrompts } from "./prompts.ts";

/**
 * Fast-lane proofs for the MCP prompts surface (spec §2.1) — the orchestration templates that
 * carry the skill flows: new-site-audit, monthly-routine, quick-wins-sprint, gsc-health-check.
 * prompts/list advertises all of them; prompts/get renders each with its argument interpolated
 * and the expected step-by-step tool sequence. The Server wiring (capability + handlers) is
 * exercised in server.test.ts.
 */

describe("listPrompts (prompts/list)", () => {
  it("advertises exactly the orchestration prompts, in order", () => {
    expect(listPrompts().prompts.map((p) => p.name)).toEqual([
      "new-site-audit",
      "monthly-routine",
      "quick-wins-sprint",
      "gsc-health-check",
    ]);
  });

  it("declares arguments for each prompt", () => {
    for (const prompt of listPrompts().prompts) {
      expect(prompt.description.length).toBeGreaterThan(0);
      expect(Array.isArray(prompt.arguments)).toBe(true);
      expect(prompt.arguments?.length).toBeGreaterThan(0);
    }
  });

  it("keeps the definition table and the advertised list in sync", () => {
    expect(listPrompts().prompts.map((p) => p.name)).toEqual(PROMPTS.map((p) => p.name));
  });
});

/** The rendered text of one prompt — every case below reads a prompt through prompts/get. */
function render(name: string, args: Record<string, string>): string {
  const message = getPrompt(name, args).messages[0];
  return message?.content.type === "text" ? message.content.text : "";
}

describe("getPrompt (prompts/get)", () => {
  it("new-site-audit walks setup -> crawl -> audit trio -> report for the given domain", () => {
    const result = getPrompt("new-site-audit", { domain: "example.com" });
    const text = result.messages[0]?.content.type === "text" ? result.messages[0].content.text : "";
    expect(result.messages[0]?.role).toBe("user");
    expect(text).toContain("example.com");
    for (const tool of ["setup_project", "crawl_site", "audit_onpage", "audit_tech", "audit_schema", "generate_report"]) {
      expect(text).toContain(tool);
    }
  });

  it("monthly-routine walks pull -> discovery trio -> report for the given project_id", () => {
    const result = getPrompt("monthly-routine", { project_id: "proj-123" });
    const text = result.messages[0]?.content.type === "text" ? result.messages[0].content.text : "";
    expect(text).toContain("proj-123");
    for (const tool of ["pull_gsc_data", "find_quick_wins", "detect_cannibalization", "analyze_content_decay", "generate_report"]) {
      expect(text).toContain(tool);
    }
  });

  it("quick-wins-sprint walks pull -> find_quick_wins -> prioritization", () => {
    const result = getPrompt("quick-wins-sprint", { project_id: "proj-9" });
    const text = result.messages[0]?.content.type === "text" ? result.messages[0].content.text : "";
    expect(text).toContain("proj-9");
    expect(text).toContain("pull_gsc_data");
    expect(text).toContain("find_quick_wins");
    expect(text).toMatch(/prioriti/i);
  });

  /**
   * B15(i) — the fallback used to name connect_gsc and nothing else, which was the only route
   * when this template was written. Since 2026-08-13 the commoner case (a Google account already
   * linked, a project simply not mapped to a property) is fixed by two 0-credit calls; sending
   * that user through an OAuth round trip is a worse answer, not merely an older one.
   */
  it("monthly-routine's no-connection fallback offers the modern route before connect_gsc", () => {
    // Read the FALLBACK paragraph, not the whole template: asserting on the full text would let
    // any incidental earlier mention of connect_gsc satisfy an ordering claim about this advice.
    const fallback = render("monthly-routine", { project_id: "proj-123" }).split("\n\n").at(-1) ?? "";
    expect(fallback).toContain("list_gsc_properties");
    expect(fallback).toContain("track_gsc_property");
    // connect_gsc is still named — it remains the answer when NO account is connected at all.
    expect(fallback).toContain("connect_gsc");
    // ...and it is named LAST, as the fallback to the fallback.
    expect(fallback.indexOf("list_gsc_properties")).toBeLessThan(fallback.indexOf("connect_gsc"));
    expect(fallback).toMatch(/0 credits/);
  });

  /**
   * B15(ii) — a Search Console connection dies quietly: a revoked grant, a removed property, a
   * downgraded permission level. The first symptom is a pull that returns nothing, which reads
   * like a site with no traffic. This prompt is the flow that tells those apart.
   */
  it("gsc-health-check walks list -> diagnose -> reconnect -> verify with a SMALL pull", () => {
    const text = render("gsc-health-check", { project_id: "proj-77" });
    expect(text).toContain("list_gsc_properties");
    expect(text).toMatch(/reconnect/i);
    expect(text).toContain("pull_gsc_data");
    expect(text).toContain("proj-77");
    // days=7, not a 90-day pull: the cheapest call that proves a credential can actually FETCH.
    expect(text).toMatch(/days.{0,12}7\b/i);
  });

  it("gsc-health-check refuses to read an unreadable account as an empty one", () => {
    const text = render("gsc-health-check", {});
    // The same rule track_gsc_property enforces: an absence we did not observe is not an absence.
    expect(text).toMatch(/could not be read|unknown rather than empty/i);
  });

  it("gsc-health-check works without a project id, leaving a readable placeholder", () => {
    const text = render("gsc-health-check", {});
    expect(text).toMatch(/<[^>]+>/);
    expect(text).not.toMatch(/undefined/);
  });

  it("renders a readable placeholder when a required argument is missing (templates stay forgiving)", () => {
    const result = getPrompt("monthly-routine", {});
    const text = result.messages[0]?.content.type === "text" ? result.messages[0].content.text : "";
    expect(text).toMatch(/<[^>]+>/); // an angle-bracket placeholder, not an empty gap
  });

  it("throws on an unknown prompt name", () => {
    expect(() => getPrompt("no-such-prompt")).toThrow(/unknown prompt/i);
  });
});
