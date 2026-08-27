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

  /**
   * THE DEAD-ACCOUNT RUNG, on the panel's own signals.
   *
   * This is the case the panel could not see at all until it read connection health: the ladder
   * has recommended `connect_gsc` for a project whose stored `token_status` is `invalid` since the
   * rung landed in core, and `whats_next` has filled the signal since the same day — so a panel
   * that derived only the other five said `pull_gsc_data` (or, on a fresh pull, "all set") for the
   * very project the assistant was telling the user to reconnect. Same project, same day, two
   * answers.
   *
   * Both halves again, and here the SECOND one carries almost nothing: with the signal missing,
   * `decideProjectNextStep` agrees with the card perfectly — they are wrong together. The literal
   * is what fails.
   */
  it("routes a connected project whose Google account is dead to connect_gsc", () => {
    const input: ProjectCardInput = {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: { created_at: FRESH, result: null },
      connection: LINKED,
      tokenStatus: "invalid",
    };
    const card = buildProjectCard(input, NOW);
    expect(card.nextStep.primary).toBe("connect_gsc");
    expect(card.nextStep).toEqual(decideProjectNextStep(deriveProjectSignals(input, NOW)));
    // Everything else about this project is fresh, so without the health signal the ladder would
    // have called it all set — the rung sits ABOVE that one precisely for this state.
    expect(card.nextStep.allSet).toBe(false);
  });

  /**
   * The other side of the same axis (signed lesson 14 — vary the VALUE, not only the presence): an
   * ACTIVE account on identical rows must still get the all-set answer. Without this, a derivation
   * that reported every measured account as dead would pass the case above and reroute every
   * healthy project on the panel to connect_gsc.
   */
  it("leaves a connected project with a live account on the ordinary ladder", () => {
    const input: ProjectCardInput = {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: { created_at: FRESH, result: null },
      connection: LINKED,
      tokenStatus: "active",
    };
    const card = buildProjectCard(input, NOW);
    expect(card.nextStep.primary).toBe("generate_report");
    expect(card.nextStep).toEqual(decideProjectNextStep(deriveProjectSignals(input, NOW)));
  });

  /**
   * A dead account that is no longer mapped to this project is not this project's problem: the
   * rung is `gscConnected && gscTokenInvalid`, and an unconnected project keeps the optional-GSC
   * route it had before (rung 2, audit the crawl).
   */
  it("keeps an unconnected project on the optional-GSC route even with a dead status", () => {
    const input: ProjectCardInput = {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: null,
      connection: { account_id: null, gsc_property: "https://example.com/" },
      tokenStatus: "invalid",
    };
    const card = buildProjectCard(input, NOW);
    expect(card.nextStep.primary).toBe("audit_onpage");
    expect(card.nextStep).toEqual(decideProjectNextStep(deriveProjectSignals(input, NOW)));
  });

  /**
   * THE UNMAPPED-PROPERTY RUNG (4b), on the panel's own signals — defect E-3, measured live
   * 2026-08-27.
   *
   * Every fixture above uses `LINKED`, which always carries a `gsc_property`. So the axis this
   * whole spec never varied was the MAPPING: core grew rung 4b on 2026-08-26 and whats_next fed
   * it the same day, while `deriveProjectSignals` emitted five signals and none of them was this
   * one. The panel therefore fell one rung further and told such a project to run `pull_gsc_data`
   * — 5 credits for a pull that CANNOT succeed without a property — which is the exact wrong that
   * rung exists to remove, left standing on the surface a human looks at.
   *
   * The literal is what fails: with the signal absent, `decideProjectNextStep` agrees with the
   * card perfectly, because they are wrong together (the same trap the dead-account case notes).
   */
  it("routes a connected project with NO property mapped to list_gsc_properties", () => {
    const input: ProjectCardInput = {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: null,
      connection: { account_id: "acct-1", gsc_property: null },
      tokenStatus: "active",
    };
    const card = buildProjectCard(input, NOW);
    expect(card.nextStep.primary).toBe("list_gsc_properties");
    expect(card.nextStep).toEqual(decideProjectNextStep(deriveProjectSignals(input, NOW)));
    // Nothing that reads a pull this project cannot take may be offered as a follow-up.
    expect(card.nextStep.upcoming).not.toContain("pull_gsc_data");
  });

  /**
   * The other side of the same axis (signed lesson 14): an identical project WITH a property
   * mapped must stay on the ordinary ladder. Without this, a derivation that called every
   * connection unmapped would pass the case above and reroute every healthy project on the panel.
   */
  it("leaves a connected project WITH a property on the ordinary ladder", () => {
    const input: ProjectCardInput = {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: null,
      connection: LINKED,
      tokenStatus: "active",
    };
    expect(buildProjectCard(input, NOW).nextStep.primary).toBe("pull_gsc_data");
  });

  /**
   * And an UNCONNECTED project whose row still carries an old property is not "missing" one:
   * the rung is `gscConnected && gscPropertyMissing`, so this must stay on rung 2.
   */
  it("does not call an unconnected project's mapping missing", () => {
    const input: ProjectCardInput = {
      project: PROJECT,
      crawl: { created_at: FRESH, result: null },
      pull: null,
      connection: { account_id: null, gsc_property: null },
      tokenStatus: null,
    };
    expect(deriveProjectSignals(input, NOW).gscPropertyMissing).toBe(false);
    expect(buildProjectCard(input, NOW).nextStep.primary).toBe("audit_onpage");
  });

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

  /**
   * The HEALTH signal, on both surfaces, from the same stored word.
   *
   * `token_status` has three readable states and only one of them is a death: a `null` (no
   * connection, no linked account) and an `"active"` both mean "nothing known to be wrong". If
   * either surface widened that to a truthiness test — `tokenStatus != null`, say — every
   * connected project on it would be routed to connect_gsc while the other kept recommending the
   * pull. So each is pinned to the equality against the stored word rather than to a boolean.
   */
  it("both surfaces call an account dead only on a stored 'invalid'", () => {
    expect(read(WHATS_NEXT_PATH)).toMatch(/gscTokenInvalid:[^,\n]*===\s*["']invalid["']/i);
    expect(codeOf(read(resolve(HERE, "signals.ts")))).toMatch(
      /gscTokenInvalid:[^,\n]*===\s*["']invalid["']/i,
    );
  });

  /**
   * The MAPPING signal, on both surfaces, meaningful only WITH a connection.
   *
   * A source pin as well as the value pins above, for the reason the health one has both: a
   * surface that derived `gscPropertyMissing` from the property ALONE would report every
   * unconnected project as unmapped, and every value case here would still pass — rung 4b sits
   * below the connect rungs, so an unconnected project never reaches it. The wrong would only
   * show up in a state no fixture holds.
   */
  it("both surfaces call a mapping missing only on a CONNECTED row", () => {
    expect(read(WHATS_NEXT_PATH)).toMatch(/propertyMissing:\s*connected\s*&&/i);
    expect(codeOf(read(resolve(HERE, "signals.ts")))).toMatch(
      /gscPropertyMissing:\s*connected\s*&&/i,
    );
  });
});

/**
 * E-9 + E-3b (smoke tour wave 4) — the two rungs the panel was NOT feeding.
 *
 * Both are the E-3a shape one signal over: core grew a rung, the MCP router adopted it, and this
 * card fell one rung further and recommended paid work. E-3b cost 20 credits against a host that
 * does not resolve; E-9 cost 15 for a report over findings nobody had produced.
 */
describe("the panel feeds the dead-domain and no-analysis rungs", () => {
  const ALL_SET: Omit<ProjectCardInput, "project"> = {
    crawl: { created_at: FRESH, result: null },
    pull: { created_at: FRESH, result: null },
    connection: LINKED,
    tokenStatus: "active",
  };

  it("E-3b: a domain DNS says does not exist is not sent to crawl_site", () => {
    const input: ProjectCardInput = {
      project: PROJECT,
      ...ALL_SET,
      crawl: null,
      pull: null,
      connection: null,
      reachability: "no_such_domain",
    };
    const card = buildProjectCard(input, NOW);

    expect(card.nextStep.primary).toBe("setup_project");
    expect(card.nextStep.primary).not.toBe("crawl_site");
    expect(card.nextStep).toEqual(decideProjectNextStep(deriveProjectSignals(input, NOW)));
    // Nothing this rung offers may cost credits — that is the whole point of it.
    expect(card.nextStep.upcoming).not.toContain("crawl_site");
  });

  /**
   * The OTHER side of the same axis (signed lesson 14 — vary the VALUE, not only the presence).
   * `"unknown"` is a measured answer meaning "the lookup could not find out", and it must route
   * exactly like a resolving domain. Without this, a derivation that treated every measured
   * lookup as a death would pass the case above and strand a whole account on one DNS blip.
   */
  it.each(["resolves", "unknown"] as const)(
    "E-3b: a %s lookup leaves the project on the ordinary ladder",
    (reachability) => {
      const input: ProjectCardInput = {
        project: PROJECT,
        ...ALL_SET,
        crawl: null,
        pull: null,
        connection: null,
        reachability,
      };
      const card = buildProjectCard(input, NOW);

      expect(card.nextStep.primary).toBe("crawl_site");
      expect(card.nextStep).toEqual(decideProjectNextStep(deriveProjectSignals(input, NOW)));
    },
  );

  it("E-9: an all-set project with NO analysis leads with quick wins, not a report", () => {
    const input: ProjectCardInput = { project: PROJECT, ...ALL_SET, hasAnalysis: false };
    const card = buildProjectCard(input, NOW);

    expect(card.nextStep.primary).toBe("find_quick_wins");
    expect(card.nextStep).toEqual(decideProjectNextStep(deriveProjectSignals(input, NOW)));
    expect(card.nextStep.allSet).toBe(true);
  });

  it("E-9: the same project WITH an analysis still gets the report", () => {
    const input: ProjectCardInput = { project: PROJECT, ...ALL_SET, hasAnalysis: true };
    const card = buildProjectCard(input, NOW);

    expect(card.nextStep.primary).toBe("generate_report");
    expect(card.nextStep).toEqual(decideProjectNextStep(deriveProjectSignals(input, NOW)));
  });

  it("an omitted signal changes nothing — the pre-signal answer, byte for byte", () => {
    const measured: ProjectCardInput = { project: PROJECT, ...ALL_SET, hasAnalysis: true };
    const omitted: ProjectCardInput = { project: PROJECT, ...ALL_SET };

    expect(buildProjectCard(omitted, NOW).nextStep).toEqual(
      buildProjectCard(measured, NOW).nextStep,
    );
  });
});

describe("both surfaces measure the two new signals the same way", () => {
  const PAGE_PATH = resolve(HERE, "../../app/app/projects/page.tsx");

  /**
   * ALL THREE RUN TABLES, on BOTH surfaces. This is the axis most likely to drift: the panel's
   * own lines cover six tools across two tables, so a future reader has every reason to think two
   * probes are enough — and a project whose only analysis was a content audit would then be told
   * nothing had been analysed. Each table is pinned by name on each surface.
   */
  it.each(["audit_runs", "gsc_discovery_runs", "audit_content_runs"])(
    "both probe %s for the analysis signal",
    (table) => {
      expect(codeOf(read(PAGE_PATH))).toContain(table);
      expect(codeOf(read(WHATS_NEXT_PATH))).toContain(table);
    },
  );

  it("both call a domain dead ONLY on a positive no-such-name", () => {
    for (const path of [PAGE_PATH, WHATS_NEXT_PATH, resolve(HERE, "signals.ts")]) {
      const code = codeOf(read(path));
      if (!/no_such_domain/.test(code)) continue;
      // Never a truthy test on the reachability verdict: "unknown" must not be a death.
      expect(code).toMatch(/===\s*["']no_such_domain["']/);
    }
  });

  it("the panel uses core's DNS port rather than its own lookup", () => {
    const source = read(PAGE_PATH);
    expect(source).toMatch(/checkDomainReachable[\s\S]{0,200}?from\s*["']@pseo\/core["']/);
    // A second resolver in apps/web would be a second answer to "did DNS say no, or not answer?"
    expect(codeOf(source)).not.toMatch(/from\s*["']node:dns/);
  });
});
