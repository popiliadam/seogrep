import { describe, expect, it } from "vitest";
// The generator is the authority this module shadows; importing it here is what turns the local
// NON_TOOL_PAGES copy from a second source of truth into a pinned mirror.
import { NON_TOOL_ALLOWLIST } from "../scripts/gen-tool-docs.mjs";
import { documentedToolNames, toolPageCount } from "./tool-surface";

describe("tool surface", () => {
  /**
   * Not a pin on 38. The point of counting is that the number FOLLOWS the registry, so asserting a
   * literal here would move the very drift this closes out of the page and into the test. What is
   * asserted is the shape: a plausible, non-empty surface whose count agrees with its name list.
   */
  it("counts the generated tool pages, and only those", () => {
    expect(toolPageCount()).toBeGreaterThan(20);
    expect(toolPageCount()).toBe(documentedToolNames().length);
    expect(documentedToolNames()).not.toContain("index");
  });

  it("keeps the non-tool page list identical to the generator's allowlist", () => {
    // If the generator gains a second hub-like page, this fails here rather than silently
    // inflating the tool count on the landing page by one.
    expect([...NON_TOOL_ALLOWLIST].sort()).toEqual(["index"]);
  });

  it("derives snake_case tool names from the page slugs", () => {
    const names = documentedToolNames();
    expect(names).toContain("setup_project");
    expect(names).toContain("ai_visibility_compare");
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
