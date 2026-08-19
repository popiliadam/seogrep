import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  DEFAULT_DISCOVER_ROWS,
  DEFAULT_RELATED_DEPTH,
  DISCOVER_ENDPOINTS,
  MAX_DISCOVER_ROWS,
  MAX_RELATED_DEPTH,
  MAX_SEEDS,
  MIN_RELATED_DEPTH,
  MODE_MEANS,
  createMockDiscoverKeywordsPort,
  disabledDiscoverKeywordsPort,
  type DiscoverKeywordRow,
  type DiscoverKeywordsPort,
  type DiscoverKeywordsResult,
  type DiscoverMode,
} from "../dfs/discover-keywords.ts";
import {
  MODE_INPUT_RULES,
  MODE_SPECIFIC_FIELDS,
  VENDOR_JUDGEMENT_NOTE,
  buildDiscoverQuery,
  describeSubject,
  formatDiscoverKeywords,
  makeDiscoverKeywordsTool,
  renderDiscoveryCaption,
  renderKeywordRow,
  vendorFunctionOf,
} from "./discover-keywords.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import ideasFixture from "../dfs/fixtures/labs-keyword-ideas.json";
import suggestionsFixture from "../dfs/fixtures/labs-keyword-suggestions.json";
import relatedFixture from "../dfs/fixtures/labs-related-keywords.json";
import forSiteFixture from "../dfs/fixtures/labs-keywords-for-site.json";

/**
 * Fast-lane (DB-less) proofs for discover_keywords. The credit LEDGER behaviour (mock -> reserve +
 * commit at 40; disabled / trial / DFS-error -> no charge) is proven against the real stack in
 * discover-keywords.db.test.ts. Here we prove the three things this surface is FOR:
 *
 *   1. THE MODE DISCRIMINATION — the four modes take four different inputs, and a field belonging
 *      to another mode is REJECTED rather than ignored. This is the whole reason Part A's query is
 *      a discriminated union, and a flat surface would give it away for free;
 *   2. NEVER #7 — every printed value is a named vendor field, the vendor's two competition
 *      measurements stay apart, a vendor silence is words rather than 0, and nothing here ranks,
 *      scores, recommends or predicts;
 *   3. the price controls — the schema's maxima are asserted AGAINST the port's caps, because the
 *      caps ARE the signed 40 (one request, at most MAX_DISCOVER_ROWS billed rows).
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const LOCALE = { language_code: "en", location_code: 2840 } as const;

const mockPort = () =>
  createMockDiscoverKeywordsPort({
    ideas: ideasFixture,
    suggestions: suggestionsFixture,
    related: relatedFixture,
    for_site: forSiteFixture,
  });

/** One lookup through the mock port, formatted — the end-to-end text every honesty pin reads. */
async function formattedFixtureAnswer(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const query = {
    mode: "ideas" as DiscoverMode,
    seeds: ["seo software"],
    limit: DEFAULT_DISCOVER_ROWS,
    offset: 0,
    ...LOCALE,
    ...overrides,
  } as Parameters<DiscoverKeywordsPort["fetchDiscoverKeywords"]>[0];
  const answer = await mockPort().fetchDiscoverKeywords(query);
  return formatDiscoverKeywords(answer, LOCALE);
}

const FULL_ROW: DiscoverKeywordRow = {
  keyword: "seo tools",
  search_volume: 40500,
  cpc: 14.22,
  competition: 0.71,
  competition_level: "HIGH",
  keyword_difficulty: 74,
  main_intent: "commercial",
  foreign_intent: ["informational"],
  search_volume_trend: { monthly: 22, quarterly: 8, yearly: -4 },
  last_updated_time: "2026-07-31 04:12:07 +00:00",
};

/** The vendor said NOTHING about this keyword but its name. Its rendering is the sharpest edge. */
const SILENT_ROW: DiscoverKeywordRow = {
  keyword: "seo software for agencies uk",
  search_volume: null,
  cpc: null,
  competition: null,
  competition_level: null,
  keyword_difficulty: null,
  main_intent: null,
  foreign_intent: [],
  search_volume_trend: null,
  last_updated_time: null,
};

/**
 * THE ENV THIS FILE MEASURES AGAINST. Every "reaches the credit guard" assertion below reads a
 * MISSING Supabase env as its signal — the guard is the first thing past the free gates, and with
 * no DB configured it throws naming SUPABASE. That makes the assertion depend on the ambient
 * shell, and it was MEASURED to matter: with the local stack's env exported (as a developer shell
 * has it during a DB-lane run) nine of these specs failed, because the reserve reached a real
 * database instead of failing. So the env is cleared per test rather than assumed — a spec whose
 * result depends on who ran it is not a measurement.
 */
const SUPABASE_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;

function withoutSupabaseEnv(): void {
  let saved: Partial<Record<(typeof SUPABASE_ENV_KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    saved = {};
    for (const key of SUPABASE_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of SUPABASE_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe("THE MODE DISCRIMINATION — four modes, four inputs, nothing borrowed", () => {
  withoutSupabaseEnv();
  const tool = makeDiscoverKeywordsTool({ port: mockPort(), loadProject });

  it("requires the mode and offers no default — a default would answer a different question", () => {
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { default?: unknown; enum?: string[] }>;
    };
    expect(schema.required ?? []).toEqual(["mode"]);
    expect(schema.properties.mode).not.toHaveProperty("default");
    // Derived from the port's endpoint table, so a mode the port gained cannot go unadvertised.
    expect(schema.properties.mode?.enum).toEqual(Object.keys(DISCOVER_ENDPOINTS));
  });

  /**
   * THE PIN THIS WHOLE FILE EXISTS FOR, on the axis the order names: a `for_site` call carrying a
   * seed. The port's union makes it a COMPILE error; without a matching runtime rule the surface
   * would accept it, drop it, and bill a domain lookup for a question about a keyword.
   *
   * Every mode is varied against every field that is not its own (signed lesson 14 — the axis is
   * named: FIELD × MODE, both directions, derived from MODE_INPUT_RULES rather than listed by
   * hand, so a rule loosened in the table turns this red).
   */
  const foreignPairs = MODE_NAMES().flatMap((mode) =>
    MODE_SPECIFIC_FIELDS.filter((field) => !MODE_INPUT_RULES[mode].takes.includes(field)).map(
      (field) => [mode, field] as const,
    ),
  );

  it.each(foreignPairs)('mode "%s" rejects "%s", which belongs to another mode', async (mode, field) => {
    const rejected = await tool.run(CTX, { ...minimalFor(mode), [field]: sampleFor(field) });
    expect(rejected.isError, `${mode} + ${field} should be rejected`).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/invalid input/i);
    expect(rejected.content[0]?.text).toContain(field);
    // ...and it says what the mode DOES take, so the caller can fix it in one step.
    expect(rejected.content[0]?.text).toContain(MODE_INPUT_RULES[mode].says);
  });

  it.each(MODE_NAMES().flatMap((mode) => MODE_INPUT_RULES[mode].requires.map((f) => [mode, f] as const)))(
    'mode "%s" refuses to run without "%s"',
    async (mode, field) => {
      const input = { ...minimalFor(mode) } as Record<string, unknown>;
      delete input[field];
      const rejected = await tool.run(CTX, input);
      expect(rejected.isError).toBe(true);
      expect(rejected.content[0]?.text).toMatch(/invalid input/i);
      expect(rejected.content[0]?.text).toContain(field);
    },
  );

  /**
   * The other direction: every mode's OWN minimal input passes validation and reaches the credit
   * guard. Without this, a refinement that rejected everything would satisfy the specs above
   * perfectly (the disavow tenant-isolation lesson, reproduced on the schema axis).
   */
  it.each(MODE_NAMES())('mode "%s" accepts its own input and reaches the credit guard', async (mode) => {
    await expect(tool.run(CTX, minimalFor(mode))).rejects.toThrow(/SUPABASE/i);
  });

  it("carries the mode's own optional field through: depth on related, subdomains on for_site", async () => {
    await expect(
      tool.run(CTX, { mode: "related", seed: "seo software", depth: MAX_RELATED_DEPTH }),
    ).rejects.toThrow(/SUPABASE/i);
    await expect(
      tool.run(CTX, { mode: "for_site", target: "example.com", include_subdomains: false }),
    ).rejects.toThrow(/SUPABASE/i);
  });

  /** The union is rejoined in ONE switch, and it defaults only where the port documents a default. */
  it("builds each mode's port query by narrowing, with the vendor's own field names", () => {
    const base = { limit: 10, offset: 0, ...LOCALE };
    expect(buildDiscoverQuery({ ...base, mode: "ideas", seeds: ["a", "b"] } as never, null)).toMatchObject({
      mode: "ideas",
      seeds: ["a", "b"],
    });
    expect(buildDiscoverQuery({ ...base, mode: "suggestions", seed: "a" } as never, null)).toMatchObject({
      mode: "suggestions",
      seed: "a",
    });
    // depth omitted -> the VENDOR's documented default, not a number invented here.
    expect(buildDiscoverQuery({ ...base, mode: "related", seed: "a" } as never, null)).toMatchObject({
      mode: "related",
      seed: "a",
      depth: DEFAULT_RELATED_DEPTH,
    });
    // The resolved domain is what reaches the vendor, and subdomains are pinned in both directions.
    expect(buildDiscoverQuery({ ...base, mode: "for_site" } as never, "example.com")).toMatchObject({
      mode: "for_site",
      target: "example.com",
      include_subdomains: true,
    });
    expect(
      buildDiscoverQuery({ ...base, mode: "for_site", include_subdomains: false } as never, "x.com"),
    ).toMatchObject({ include_subdomains: false });
  });
});

describe("the price controls — the schema's maxima ARE the port's caps", () => {
  const tool = makeDiscoverKeywordsTool();

  /**
   * THE ROW CAP IS THE PRICE. The 2026-08-17 signature priced this tool at 40 credits with the
   * worst case measured at 1,000 rows / 3.8x, and DROPPED the v1 idea of a second price above
   * `limit` > 500 — so ONE price stands on ONE cap. The maxima are asserted AGAINST the port's
   * constants rather than restated: a surface that accepted more than the port clamps to would
   * advertise a window the price was never signed for (NEVER #6).
   */
  it("caps limit, seeds and depth at exactly the port's constants", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<
        string,
        { default?: number; maximum?: number; minimum?: number; maxItems?: number; minItems?: number }
      >;
    };
    expect(schema.properties.limit?.minimum).toBe(1);
    expect(schema.properties.limit?.maximum).toBe(MAX_DISCOVER_ROWS);
    expect(schema.properties.limit?.default).toBe(DEFAULT_DISCOVER_ROWS);
    expect(schema.properties.seeds?.maxItems).toBe(MAX_SEEDS);
    expect(schema.properties.seeds?.minItems).toBe(1);
    expect(schema.properties.depth?.minimum).toBe(MIN_RELATED_DEPTH);
    expect(schema.properties.depth?.maximum).toBe(MAX_RELATED_DEPTH);
    expect(schema.properties.offset?.minimum).toBe(0);
  });

  it("rejects a row count past the cap, and a seed list past the vendor's ceiling, before any work", async () => {
    const wide = await tool.run(CTX, { mode: "suggestions", seed: "x", limit: MAX_DISCOVER_ROWS + 1 });
    expect(wide.isError).toBe(true);
    expect(wide.content[0]?.text).toMatch(/invalid input/i);

    const seeds = await tool.run(CTX, {
      mode: "ideas",
      seeds: Array.from({ length: MAX_SEEDS + 1 }, (_, i) => `k${i}`),
    });
    expect(seeds.isError).toBe(true);

    const deep = await tool.run(CTX, { mode: "related", seed: "x", depth: MAX_RELATED_DEPTH + 1 });
    expect(deep.isError).toBe(true);
  });

  it("advertises its name, the 40-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("discover_keywords");
    expect(tool.description).toContain("Costs 40 credits.");
    const schema = tool.inputJsonSchema as { properties: Record<string, { format?: string }> };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "depth",
      "include_subdomains",
      "language_code",
      "limit",
      "location_code",
      "max_difficulty",
      "min_volume",
      "mode",
      "offset",
      "project_id",
      "seed",
      "seeds",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
  });

  it("says it needs a paid balance and promises the free refusal", () => {
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
    expect(tool.description).not.toMatch(/is (currently )?(turned )?off\b/i);
  });
});

describe("NEVER #7 — the vendor's fields, under the vendor's names, with no verdict of ours", () => {
  it("prints every metric under its own vendor field name, unmerged", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).toContain("search_volume 40,500");
    expect(text).toContain("cpc 14.22");
    // The vendor's TWO competition fields, side by side: a 0-1 float and a band.
    expect(text).toContain("competition 0.71");
    expect(text).toContain("competition_level HIGH");
    expect(text).toContain("keyword_difficulty 74");
    expect(text).toContain("main_intent commercial");
    expect(text).toContain("foreign_intent informational");
    expect(text).toContain(VENDOR_JUDGEMENT_NOTE);
  });

  /**
   * THE VENDOR SILENCE, in the place it costs most. A keyword DataForSEO returned no volume for is
   * rendered in WORDS: printed as 0 it would read "nobody searches this" — from a response that
   * said nothing — and 0 is a number a reader will act on.
   */
  it("prints an unreported field as unreported, never as 0", () => {
    const row = renderKeywordRow(SILENT_ROW);
    expect(row).toContain("search_volume not reported by DataForSEO");
    expect(row).toContain("competition not reported by DataForSEO");
    expect(row).toContain("competition_level not reported by DataForSEO");
    expect(row).toContain("keyword_difficulty not reported by DataForSEO");
    expect(row).toContain("main_intent not reported by DataForSEO");
    expect(row).not.toMatch(/search_volume 0\b/);
    expect(row).not.toMatch(/keyword_difficulty 0\b/);
    expect(row).not.toMatch(/competition 0\b/);
  });

  /** A vendor ZERO is the vendor's own answer and prints as 0 — the other half of the same rule. */
  it("prints a vendor zero as zero — that is an answer, not a silence", () => {
    const row = renderKeywordRow({
      ...FULL_ROW,
      search_volume: 0,
      keyword_difficulty: 0,
      search_volume_trend: { monthly: 0, quarterly: null, yearly: -6 },
    });
    expect(row).toContain("search_volume 0");
    expect(row).toContain("keyword_difficulty 0");
    expect(row).toContain("monthly 0%");
    expect(row).not.toMatch(/search_volume not reported/);
  });

  /** …and on the real fixture, whose for_site row carries a genuine 0 in the trend. */
  it("keeps a fixture's vendor zero as 0 while its silent siblings stay words", async () => {
    const text = await formattedFixtureAnswer({ mode: "for_site", target: "example.com", include_subdomains: true, seeds: undefined });
    expect(text).toContain("monthly 0%");
    expect(text).toContain("search_volume not reported by DataForSEO");
  });

  /**
   * The one field whose ABSENCE cannot be told from an empty list (the port collapses both to []).
   * So an empty one prints NOTHING — "no secondary intent" would be a claim about a response that
   * may never have mentioned intent at all.
   */
  it("says nothing at all about an empty foreign_intent, rather than claiming there is none", () => {
    const row = renderKeywordRow({ ...FULL_ROW, foreign_intent: [] });
    expect(row).not.toContain("foreign_intent");
    expect(row).not.toMatch(/no (secondary )?intent/i);
    expect(renderKeywordRow({ ...FULL_ROW, foreign_intent: ["informational", "transactional"] })).toContain(
      "foreign_intent informational, transactional",
    );
  });

  /** A trend the vendor omitted prints nothing; a PARTIAL trend keeps its silent leg in words. */
  it("prints a partial trend partially and an absent trend not at all", () => {
    expect(renderKeywordRow({ ...FULL_ROW, search_volume_trend: null })).not.toContain(
      "search_volume_trend",
    );
    expect(
      renderKeywordRow({ ...FULL_ROW, search_volume_trend: { monthly: -3, quarterly: null, yearly: 17 } }),
    ).toContain("search_volume_trend monthly -3%, quarterly not reported, yearly +17%");
  });

  /**
   * A composite score is the one thing this tool must not produce. "Which keywords should I
   * target" is the caller's decision, and nothing in the answer may read as SeoGrep's verdict, as
   * a prediction about Google, or as an instruction.
   */
  it("invents no score, no difficulty verdict and no recommendation", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).not.toMatch(/opportunity score/i);
    expect(text).not.toMatch(/\bseogrep (score|rating|verdict)\b/i);
    expect(text).not.toMatch(/\b(easy|quick) (win|keyword)/i);
    expect(text).not.toMatch(/\blow.hanging\b/i);
    expect(text).not.toMatch(/(should|recommend|we suggest) (target|write|go after)/i);
    expect(text).not.toMatch(/\byou (will|would) rank\b/i);
    expect(text).not.toMatch(/\bestimated traffic\b/i);
    // The CLAIM shape, not the word: the judgement note REFUTES both of these in its own
    // sentence ("calls no keyword easy or worth targeting"), and a bare /worth targeting/ was
    // measured red against the refusal itself — a negative pin that fires on the disclaimer is a
    // pin that gets deleted, taking the real guard with it (the disavow quoted-superlative case).
    expect(text).not.toMatch(/\b(is|are) worth targeting\b/i);
    expect(text).not.toMatch(/\b(is|are) easy\b/i);
    // ...and it says out loud what keyword_difficulty is not.
    expect(text).toMatch(/not a forecast of where your site would rank/i);
    expect(text).toMatch(/which of these to target is your decision/i);
  });

  /**
   * NO SUPERLATIVE ABOUT THE PRODUCT, on the axis two referees already paid for on the sibling
   * surface: a ranking of this tool against other tools by vendor requests. No registry carries a
   * per-call request count, so such a claim is uncheckable by construction — the SHAPE is
   * forbidden rather than corrected. Read as SOURCE, comments included, because last time the
   * sentence lived in a comment before it was copied onto a published page.
   */
  it("this module's own source ranks nothing it has no number for", () => {
    const source = readFileSync(new URL("./discover-keywords.ts", import.meta.url), "utf8");
    for (const pattern of [
      /the most of any/i,
      /more than any other/i,
      /(?:the )?heaviest\b/i,
      /(?:the )?most (?:requests|round.?trips|calls)/i,
      /(?:the )?(?:largest|biggest|highest) number of (?:requests|round.?trips|calls)/i,
      /than any other (?:tool|seogrep)/i,
      /\bbest (?:tool|way) (?:for|to)/i,
    ]) {
      expect(source, `uncheckable superlative matching ${pattern}`).not.toMatch(pattern);
    }
    // ...and it re-orders nothing: the vendor's order is the only order in the answer.
    expect(source).not.toMatch(/\.sort\(/);
    expect(source).not.toMatch(/\.reverse\(\)/);
  });
});

describe("the output says WHICH question was answered, and over WHAT window", () => {
  /** The mode label is read off the ENDPOINT that is really requested — not retyped beside it. */
  it("names the vendor function from the endpoint the money is spent at", () => {
    expect(vendorFunctionOf("ideas")).toBe("keyword_ideas");
    expect(vendorFunctionOf("suggestions")).toBe("keyword_suggestions");
    expect(vendorFunctionOf("related")).toBe("related_keywords");
    expect(vendorFunctionOf("for_site")).toBe("keywords_for_site");
    for (const mode of MODE_NAMES()) {
      expect(DISCOVER_ENDPOINTS[mode]).toContain(`/${vendorFunctionOf(mode)}/live`);
    }
  });

  it.each(MODE_NAMES())('heads a "%s" answer with that mode and prints what it means', async (mode) => {
    const text = await formattedFixtureAnswer({ ...minimalPortQuery(mode) });
    expect(text).toContain(`DataForSEO Labs ${vendorFunctionOf(mode)} (mode "${mode}")`);
    expect(text).toContain(`What this mode returns: ${MODE_MEANS[mode]}`);
  });

  /**
   * A `keywords_for_site` answer must never read as a `related_keywords` one. The label comes from
   * the RESULT, not the input — measured, because reading it off the request would print the mode
   * the caller asked for even when the port answered a different one.
   */
  it("labels the answer by the RESULT's mode, not by the mode that was requested", async () => {
    const answer = await mockPort().fetchDiscoverKeywords({
      mode: "for_site",
      target: "example.com",
      include_subdomains: true,
      limit: 10,
      offset: 0,
      ...LOCALE,
    });
    const mislabelled: DiscoverKeywordsResult = {
      ...answer,
      mode: "related",
      mode_means: MODE_MEANS.related,
      subject: { mode: "related", seed: "seo platform", depth: 1 },
      ordered_by_vendor_field: "keyword_data.keyword_info.search_volume",
    };
    const text = formatDiscoverKeywords(mislabelled, LOCALE);
    expect(text).toContain('DataForSEO Labs related_keywords (mode "related")');
    expect(text).not.toContain("keywords_for_site");
    expect(text).toContain("keyword_data.keyword_info.search_volume");
  });

  it("describes each mode's subject in that mode's own terms", () => {
    expect(describeSubject({ mode: "ideas", seeds: ["a", "b"] })).toBe('2 seed keywords ("a", "b")');
    expect(describeSubject({ mode: "suggestions", seed: "a" })).toBe('the seed keyword "a"');
    expect(describeSubject({ mode: "related", seed: "a", depth: 3 })).toBe(
      'the seed keyword "a", search depth 3',
    );
    expect(describeSubject({ mode: "for_site", target: "example.com", include_subdomains: true })).toBe(
      '"example.com" and its subdomains',
    );
    expect(
      describeSubject({ mode: "for_site", target: "example.com", include_subdomains: false }, PROJECT),
    ).toBe('your project "example.com", subdomains excluded');
  });

  /**
   * THE WINDOW IS NOT THE SET. The rows in hand and the vendor's whole-set count are printed as
   * two different facts, and the sentence that stops the arithmetic is kept word for word from the
   * shared caption it deliberately does not reuse (that one says "for this target in total", and
   * three of these four modes have no target at all).
   */
  it("captions the window with its own bounds and the vendor's whole-set count, kept apart", async () => {
    const text = await formattedFixtureAnswer();
    expect(text).toContain("Keywords — 3 keywords in this window (offset 0, limit 100)");
    expect(text).toContain("DataForSEO counts 48,213 keywords matching this lookup in total");
    expect(text).toContain("this window is a slice of that set, not a count of it");
    expect(text).not.toMatch(/\b3 of 48,213\b/);
  });

  it("says so plainly when the vendor gave no total, instead of back-filling one", () => {
    const caption = renderDiscoveryCaption({
      window_offset: 20,
      window_limit: 50,
      window_row_count: 2,
      vendor_total_count: null,
      rows: [FULL_ROW, SILENT_ROW],
    });
    expect(caption).toContain("Keywords — 2 keywords in this window (offset 20, limit 50)");
    expect(caption).toContain("DataForSEO did not say how many keywords this lookup matches in total");
    expect(caption).not.toMatch(/counts 2 keywords/);
  });

  /** The ordering field is printed VERBATIM from the result, prefix and all. */
  it("names the ONE vendor field the rows are ordered by", async () => {
    expect(await formattedFixtureAnswer()).toContain(
      "by keyword_info.search_volume, highest first",
    );
    expect(await formattedFixtureAnswer({ ...minimalPortQuery("related") })).toContain(
      "by keyword_data.keyword_info.search_volume, highest first",
    );
  });

  it("prints the vendor filters exactly as they were sent, or says none were", async () => {
    expect(await formattedFixtureAnswer()).toContain("No vendor filter was applied");
    const filtered = await formattedFixtureAnswer({ min_volume: 500, max_difficulty: 40 });
    expect(filtered).toContain(
      '[["keyword_info.search_volume",">=",500],"and",["keyword_properties.keyword_difficulty","<=",40]]',
    );
    expect(filtered).toMatch(/bounds you chose, not ones SeoGrep or DataForSEO recommends/);
  });

  /**
   * The empty answer is a DELIVERED result (and is charged), so it must still say what was asked
   * and refuse the reading "there are no such keywords" — which is what a bare "none found" over a
   * 100-row window with a difficulty filter would mean to a reader.
   */
  it("says plainly when nothing came back, naming the window and refusing the wider reading", () => {
    const empty: DiscoverKeywordsResult = {
      mode: "suggestions",
      mode_means: MODE_MEANS.suggestions,
      subject: { mode: "suggestions", seed: "seo software" },
      ordered_by_vendor_field: "keyword_info.search_volume",
      vendor_filters_applied: [["keyword_info.search_volume", ">=", 5000]],
      window: {
        window_offset: 0,
        window_limit: 100,
        window_row_count: 0,
        vendor_total_count: 0,
        rows: [],
      },
    };
    const text = formatDiscoverKeywords(empty, LOCALE);
    expect(text).toContain('No keywords for the seed keyword "seo software"');
    expect(text).toContain("(offset 0, limit 100)");
    expect(text).toMatch(/not a statement that no such keywords exist/i);
    expect(text).toContain('[["keyword_info.search_volume",">=",5000]]');
  });

  it("names the resolved PROJECT in the heading when the domain came from one", () => {
    const forSite: DiscoverKeywordsResult = {
      mode: "for_site",
      mode_means: MODE_MEANS.for_site,
      subject: { mode: "for_site", target: "example.com", include_subdomains: true },
      ordered_by_vendor_field: "keyword_info.search_volume",
      vendor_filters_applied: [],
      window: {
        window_offset: 0,
        window_limit: 100,
        window_row_count: 1,
        vendor_total_count: 12,
        rows: [FULL_ROW],
      },
    };
    expect(formatDiscoverKeywords(forSite, LOCALE, PROJECT)).toContain(
      'Keyword discovery for your project "example.com"',
    );
    expect(formatDiscoverKeywords(forSite, LOCALE)).not.toContain("your project");
  });
});

describe("discover_keywords free pre-reserve gates (no credit machinery)", () => {
  withoutSupabaseEnv();

  const serving = () => makeDiscoverKeywordsTool({ port: mockPort(), loadProject });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeDiscoverKeywordsTool({ port: disabledDiscoverKeywordsPort(), loadProject });
    const refused = await tool.run(CTX, { mode: "suggestions", seed: "seo software" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toMatch(/not yet enabled/i);
    expect(refused.content[0]?.text).toMatch(/not charged/i);
    // ...and it never leaks the fixture keywords it could have served instead (NEVER #7).
    expect(refused.content[0]?.text).not.toMatch(/best seo software 2026/i);
    expect(refused.content[0]?.text).not.toContain("search_volume");
  });

  it("rejects a non-public domain for the one mode that takes a domain", async () => {
    const rejected = await serving().run(CTX, { mode: "for_site", target: "not a domain" });
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0]?.text).toMatch(/not a valid domain/i);

    const reserved = await serving().run(CTX, { mode: "for_site", target: "intranet.local" });
    expect(reserved.isError).toBe(true);
    expect(reserved.content[0]?.text).toMatch(/not a public domain/i);
  });

  it("rejects a for_site call naming NEITHER project_id nor target, and one naming BOTH", async () => {
    const neither = await serving().run(CTX, { mode: "for_site" });
    expect(neither.isError).toBe(true);
    expect(neither.content[0]?.text).toMatch(/Nothing to look up/i);

    const both = await serving().run(CTX, {
      mode: "for_site",
      target: "example.com",
      project_id: PROJECT_ID,
    });
    expect(both.isError).toBe(true);
    expect(both.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await serving().run(CTX, { mode: "for_site", project_id: OTHER_PROJECT_ID });
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
  });

  it("a RESOLVED project_id reaches the credit guard — the gates are not a dead end", async () => {
    await expect(
      serving().run(CTX, { mode: "for_site", project_id: PROJECT_ID }),
    ).rejects.toThrow(/SUPABASE/i);
  });

  /**
   * The three SEED modes read no project at all, so they do not depend on the project table being
   * reachable. Proven by a loader that throws: any of them touching it would surface here.
   */
  it.each(["ideas", "suggestions", "related"] as const)(
    'mode "%s" never reads a project',
    async (mode) => {
      const tool = makeDiscoverKeywordsTool({
        port: mockPort(),
        loadProject: async () => {
          throw new Error("the project table must not be read for a seed mode");
        },
      });
      await expect(tool.run(CTX, minimalFor(mode))).rejects.toThrow(/SUPABASE/i);
    },
  );
});

/** The modes, read from the port's own table (a helper, so the derivation is stated once). */
function MODE_NAMES(): DiscoverMode[] {
  return Object.keys(DISCOVER_ENDPOINTS) as DiscoverMode[];
}

/** The smallest valid tool input for a mode. */
function minimalFor(mode: DiscoverMode): Record<string, unknown> {
  switch (mode) {
    case "ideas":
      return { mode, seeds: ["seo software"] };
    case "suggestions":
    case "related":
      return { mode, seed: "seo software" };
    case "for_site":
      return { mode, target: "example.com" };
  }
}

/** The smallest valid PORT query for a mode (the mock port takes the port's own shape). */
function minimalPortQuery(mode: DiscoverMode): Record<string, unknown> {
  switch (mode) {
    case "ideas":
      return { mode, seeds: ["seo software"], seed: undefined, target: undefined };
    case "suggestions":
      return { mode, seed: "seo software", seeds: undefined, target: undefined };
    case "related":
      return { mode, seed: "seo software", depth: 1, seeds: undefined, target: undefined };
    case "for_site":
      return { mode, target: "example.com", include_subdomains: true, seeds: undefined, seed: undefined };
  }
}

/** A value of the right KIND for each mode-specific field, for the foreign-field matrix. */
function sampleFor(field: (typeof MODE_SPECIFIC_FIELDS)[number]): unknown {
  switch (field) {
    case "seeds":
      return ["seo software"];
    case "seed":
      return "seo software";
    case "depth":
      return 2;
    case "target":
      return "example.com";
    case "project_id":
      return PROJECT_ID;
    case "include_subdomains":
      return true;
  }
}
