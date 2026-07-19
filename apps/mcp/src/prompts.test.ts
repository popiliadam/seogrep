import { describe, expect, it } from "vitest";
import { PROMPTS, getPrompt, listPrompts } from "./prompts.ts";

/**
 * Fast-lane proofs for the MCP prompts surface (spec §2.1) — the three orchestration templates
 * that carry the skill flows: new-site-audit, monthly-routine, quick-wins-sprint. prompts/list
 * advertises all three; prompts/get renders each with its argument interpolated and the expected
 * step-by-step tool sequence. The Server wiring (capability + handlers) is exercised in
 * server.test.ts.
 */

describe("listPrompts (prompts/list)", () => {
  it("advertises exactly the three orchestration prompts, in order", () => {
    expect(listPrompts().prompts.map((p) => p.name)).toEqual([
      "new-site-audit",
      "monthly-routine",
      "quick-wins-sprint",
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

  it("renders a readable placeholder when a required argument is missing (templates stay forgiving)", () => {
    const result = getPrompt("monthly-routine", {});
    const text = result.messages[0]?.content.type === "text" ? result.messages[0].content.text : "";
    expect(text).toMatch(/<[^>]+>/); // an angle-bracket placeholder, not an empty gap
  });

  it("throws on an unknown prompt name", () => {
    expect(() => getPrompt("no-such-prompt")).toThrow(/unknown prompt/i);
  });
});
