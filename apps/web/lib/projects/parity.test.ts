import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decideProjectNextStep } from "@pseo/core";
import { describe, expect, it } from "vitest";
import { buildProjectCard, type ProjectCardInput } from "./card";
import { deriveProjectSignals } from "./signals";

/**
 * PARITY: the panel's "Next step" and the MCP `whats_next` tool must name the SAME tool for the
 * same project on the same day.
 *
 * Two halves, because either alone would be green for the wrong reason:
 *
 *   1. VALUE — for a spread of fixture states, the card's primary is exactly what
 *      `decideProjectNextStep` returns for the signals derived from those same rows.
 *   2. SOURCE — the ladder the card runs is CORE's, not a copy that happens to agree today,
 *      and the MCP tool runs that same imported ladder over signals derived the same way.
 *
 * Half 1 without half 2 would still pass if someone pasted the ladder into apps/web and the two
 * copies later drifted; half 2 without half 1 would pass while the card fed it wrong signals.
 *
 * The greps use the SHORTEST DISTINCTIVE fragment rather than a copied source literal (signed
 * lesson 11): a regex that only matches a whole pasted line stops matching on the first
 * reformat and starts reporting a drift that did not happen.
 */

/** `pathname` percent-encodes; this repo's path contains a space, so decode it properly. */
const HERE = dirname(fileURLToPath(import.meta.url));

const WHATS_NEXT_PATH = resolve(HERE, "../../../mcp/src/tools/whats-next.ts");

/**
 * Comments out, statements only — because PROSE IS NOT CODE (the rsc-boundary spec's rule, and
 * the reason it strips before matching). Both negative assertions below would otherwise fail on
 * a doc comment that merely NAMES the thing it forbids: this file's own modules explain why the
 * window is imported rather than re-typed, and saying "a literal 30" is not writing one.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `parity spec could not read ${path}. If the module moved, point this spec at its new ` +
        "home — do NOT delete the spec: it is the only thing pinning the panel and whats_next " +
        "to one ladder.",
    );
  }
}

const NOW = new Date("2026-08-14T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PROJECT = { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" };

function ago(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

const FRESH = ago(1);
const STALE = ago(120);
const LINKED = { account_id: "acct-1", gsc_property: "sc-domain:example.com" };

/** The rungs, each as the ROWS a project would actually have, plus the tool whats_next names. */
const CASES: readonly { name: string; input: ProjectCardInput; primary: string }[] = [
  {
    name: "no crawl at all",
    input: { project: PROJECT, crawl: null, pull: null, connection: null },
    primary: "crawl_site",
  },
  {
    name: "a fresh crawl, Search Console not connected",
    input: {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: null,
      connection: null,
    },
    primary: "audit_onpage",
  },
  {
    name: "a fresh crawl, Search Console connected, nothing pulled",
    input: {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: null,
      connection: LINKED,
    },
    primary: "pull_gsc_data",
  },
  {
    name: "a stale pull",
    input: {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: { created_at: STALE, result: null },
      connection: LINKED,
    },
    primary: "pull_gsc_data",
  },
  {
    name: "a fresh pull but a stale crawl",
    input: {
      project: PROJECT,
      crawl: { created_at: STALE, result: null },
      pull: { created_at: FRESH, result: null },
      connection: LINKED,
    },
    primary: "crawl_site",
  },
  {
    name: "everything present and fresh",
    input: {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: { created_at: FRESH, result: null },
      connection: LINKED,
    },
    primary: "generate_report",
  },
];

describe("the panel names the same next step as whats_next", () => {
  for (const testCase of CASES) {
    it(`recommends ${testCase.primary} for ${testCase.name}`, () => {
      const card = buildProjectCard(testCase.input, NOW);
      // The literal, so a silent change to the ladder is visible here and not merely tautological
      // against itself.
      expect(card.nextStep.primary).toBe(testCase.primary);
      // And the ladder's own answer for the signals these rows produce — the exact call
      // whats_next makes, on the exact signals whats_next would derive.
      const signals = deriveProjectSignals(testCase.input, NOW);
      expect(card.nextStep).toEqual(decideProjectNextStep(signals));
    });
  }

  // Defect #52 reaches the LADDER too, not only the status line: a project whose row lost its
  // account must be routed to audit_onpage (rung 2), never to pull_gsc_data (rung 3).
  it("routes a row-but-no-account project as NOT connected", () => {
    const card = buildProjectCard(
      {
        project: PROJECT,
        crawl: { created_at: FRESH, result: null },
        pull: null,
        connection: { account_id: null, gsc_property: "https://example.com/" },
      },
      NOW,
    );
    expect(card.nextStep.primary).toBe("audit_onpage");
  });
});

describe("the ladder is core's, on both surfaces", () => {
  it("the card imports decideProjectNextStep from @pseo/core and defines no ladder of its own", () => {
    const source = read(resolve(HERE, "card.ts"));
    expect(source).toMatch(/decideProjectNextStep[\s\S]{0,200}?from\s*["']@pseo\/core["']/);
    // A local copy would have to name the rungs it returns; nothing in apps/web may.
    expect(codeOf(source)).not.toMatch(/allSet\s*:/);
  });

  it("the signal layer takes the freshness window from core rather than a literal", () => {
    const source = read(resolve(HERE, "signals.ts"));
    expect(source).toMatch(/FRESHNESS_WINDOW_DAYS[\s\S]{0,200}?from\s*["']@pseo\/core["']/);
    expect(source).toMatch(/FRESHNESS_WINDOW_DAYS\s*\*\s*MS_PER_DAY/);
    // The window may not be re-typed here: a literal 30 is a second place for it to live.
    expect(codeOf(source)).not.toMatch(/\b30\b/);
  });

  it("whats_next runs that same imported ladder", () => {
    const source = read(WHATS_NEXT_PATH);
    expect(source).toMatch(/decideProjectNextStep[\s\S]{0,300}?from\s*["']@pseo\/core["']/);
    expect(source).toMatch(/decideProjectNextStep\(/);
  });

  /**
   * The SIGNALS, not just the ladder. `deriveProjectSignals` was written from these three
   * definitions; if whats_next changes one, the two surfaces start disagreeing while every
   * value spec above stays green — so each is pinned by its shortest distinctive fragment.
   */
  it("whats_next derives the same three signals", () => {
    const source = read(WHATS_NEXT_PATH);
    // hasCrawl / hasPull: a succeeded job exists.
    expect(source).toMatch(/hasCrawl:\s*crawl\s*!==\s*null/i);
    expect(source).toMatch(/hasPull:\s*pull\s*!==\s*null/i);
    // crawlFresh / pullFresh: that job's created_at, through isFresh.
    expect(source).toMatch(/crawlFresh:[^,]*isFresh\(/i);
    expect(source).toMatch(/pullFresh:[^,]*isFresh\(/i);
    // isFresh itself: within the window, boundary inclusive.
    expect(source).toMatch(/FRESHNESS_WINDOW_DAYS\s*\*\s*MS_PER_DAY/);
    expect(source).toMatch(/<=\s*FRESHNESS_WINDOW_DAYS/);
    // gscConnected: the account_id, NOT the row (defect #52).
    expect(source).toMatch(/account_id\s*!=\s*null/i);
  });
});
