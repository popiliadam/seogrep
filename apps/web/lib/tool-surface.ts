import toolsMeta from "../content/docs/tools-reference/meta.json";

/**
 * Pages in the tools-reference nav that are NOT tools. Mirrors NON_TOOL_ALLOWLIST in
 * scripts/gen-tool-docs.mjs; tool-surface.test.ts fails if the two ever disagree, so this copy
 * cannot drift the way the copies in deploy-mcp.yml did.
 */
const NON_TOOL_PAGES = new Set(["index"]);

/** Every documented tool NAME, derived from the generated nav (setup-project → setup_project). */
export function documentedToolNames(): readonly string[] {
  return toolsMeta.pages.filter((page) => !NON_TOOL_PAGES.has(page)).map((page) => page.replace(/-/g, "_"));
}

/**
 * The live tool surface, counted from the GENERATED reference nav rather than typed anywhere.
 *
 * WHY THIS IS TRUSTWORTHY. meta.json is not written by hand: gen-tool-docs.mjs emits it from the
 * MCP registry's ALL_TOOLS, and `--check` pins it against that registry BY NAME AND ORDER. That
 * check is a step of guardrails/verify.sh, a required CI check — so this count follows the number
 * of tools the server really publishes, through a gate that is already watching.
 *
 * WHY IT IS COUNTED AT ALL. The landing page enumerated 16 tools while the server published 38 — a
 * marketing surface understating the product by more than half, with the entire paid DataForSEO
 * family (backlinks, competitors, rankings, AI visibility) absent from it (L-05, audit 2026-08-26).
 * A typed number would go stale the same way; this one cannot.
 *
 * Read from meta.json rather than from lib/source: the fumadocs collection cannot be loaded in the
 * unit-test environment, so a page built on it would be a page no test could render.
 */
export function toolPageCount(): number {
  return documentedToolNames().length;
}
