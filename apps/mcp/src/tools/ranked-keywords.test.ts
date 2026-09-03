import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  DEFAULT_RANKED_KEYWORDS_LIMIT,
  createMockRankedKeywordsPort,
  disabledRankedKeywordsPort,
  parseRankedKeywordsResponse,
  type RankedKeywordRow,
  type RankedKeywordsPort,
  type RankedKeywordsQuery,
  type RankedKeywordsResult,
} from "../dfs/ranked-keywords.ts";
import {
  EMPTY_ORGANIC_METRICS,
  WHOLE_DOMAIN_MEASUREMENT_NOTE,
  type DomainOrganicMetrics,
} from "../dfs/competitors.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import {
  fetchAndRenderRankedKeywords,
  formatRankedKeywords,
  makeRankedKeywordsTool,
} from "./ranked-keywords.ts";
import {
  SEARCH_VOLUME_BAND_NOTE,
  SEARCH_VOLUME_DESCRIPTION_CLAUSE,
  SEARCH_VOLUME_NOTE,
} from "../format/search-volume.ts";
import fixtureResponse from "../dfs/fixtures/ranked-keywords.json";

/** A row with nothing but a keyword — every expectation below adds only the field it is about. */
function row(overrides: Partial<RankedKeywordRow> = {}): RankedKeywordRow {
  return {
    keyword: "kw",
    position: null,
    absolute_position: null,
    search_volume: null,
    cpc: null,
    competition_level: null,
    last_updated_time: null,
    etv: null,
    title: null,
    type: null,
    url: null,
    keyword_difficulty: null,
    main_intent: null,
    foreign_intent: [],
    rank_change: null,
    serp_item_types: [],
    check_url: null,
    ...overrides,
  };
}

/** A result with no domain health card — the pre-existing specs are all about the TABLE. */
function result(overrides: Partial<RankedKeywordsResult> = {}): RankedKeywordsResult {
  return {
    target: "example.com",
    total_count: null,
    items_count: null,
    metrics: EMPTY_ORGANIC_METRICS,
    rows: [],
    ...overrides,
  };
}

/** A populated health card, one field at a time overridable. */
function metrics(overrides: Partial<DomainOrganicMetrics> = {}): DomainOrganicMetrics {
  return { ...EMPTY_ORGANIC_METRICS, ...overrides };
}

/**
 * Fast-lane (DB-less) proofs for ranked_keywords. The credit LEDGER behaviour (mock ->
 * reserve+commit at 65; disabled / DFS-error -> no charge) is proven against the real stack in
 * ranked-keywords.db.test.ts. Here we prove: the pure formatter, the tool metadata, and —
 * critically — that BOTH free pre-reserve gates (invalid domain, live-disabled) return without
 * touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const RENDER_INPUT = { language_code: "en", location_code: 2840 } as const;

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "adstark.com.tr", archivedAt: null };

/** Models the real loader: rows are keyed by (userId, projectId), so nobody sees another tenant's. */
const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

describe("formatRankedKeywords", () => {
  it("renders a ranked-keyword table headed by the shown/total count", () => {
    const text = formatRankedKeywords(
      result({
        total_count: 5312,
        rows: [
          row({
            keyword: "seo software",
            position: 3,
            search_volume: 22200,
            url: "https://example.com/seo-software",
          }),
          row({
            keyword: "rank tracker",
            position: 18,
            search_volume: 8100,
            url: "https://example.com/rank-tracker",
          }),
        ],
      }),
      RENDER_INPUT,
    );
    // Unchanged, deliberately: everything this slice added is ABSENT from these rows, and an
    // added field must not rearrange the line a reader already knows.
    // The R-8.9 note (format/search-volume.ts) is APPENDED as its own block: the heading and the
    // two rows are byte-identical to what a reader already knows, and this pin still fails on any
    // change to them.
    expect(text).toBe(
      'Ranked keywords for "example.com" (language en, location 2840) — 2 ranked keywords of 5,312:\n' +
        "• seo software — position #3, volume 22,200, https://example.com/seo-software\n" +
        "• rank tracker — position #18, volume 8,100, https://example.com/rank-tracker\n\n" +
        SEARCH_VOLUME_NOTE,
    );
  });

  /**
   * Live product test, 2026-08-07. adstark.com.tr (a Turkish site) was looked up with the
   * DEFAULT locale and returned 3 keywords, all at volume 30; the same domain at tr/2792
   * returned volumes up to 3,600. The tool takes a bare `target`, not a project_id, so it
   * cannot know the site's country — but a thin result under the US default is exactly when
   * it should say so, instead of letting the user pay 65 credits twice to find out.
   */
  it("hints at the locale when the US default returns a thin result", () => {
    const text = formatRankedKeywords(
      result({
        target: "adstark.com.tr",
        total_count: 3,
        rows: [row({ keyword: "seo uzmani", position: 23, search_volume: 30 })],
      }),
      RENDER_INPUT,
    );
    expect(text).toMatch(/location_code/);
    expect(text).toMatch(/language_code/);
    // The table above does not characterise the count, so this branch DOES lead with it.
    expect(text).toMatch(/Few results\. This looked up the United States in English/);
  });

  /**
   * Referee catch on this slice: zero rows is the THINNEST possible result — squarely inside the
   * code's own THIN_RESULT_ROWS definition — and it was the one path that skipped the hint, via
   * an early return. It is also the exact case the slice exists for: a Turkish site that ranks
   * for nothing in the US pays 65 credits, is told it "has no rankings on record", and never
   * learns the lookup was pointed at the wrong country.
   */
  it("hints at the locale when the default locale found NOTHING at all", () => {
    const text = formatRankedKeywords(
      result({ target: "adstark.com.tr", total_count: 0 }),
      RENDER_INPUT,
    );
    expect(text).toMatch(/no google organic rankings on record/i);
    expect(text).toMatch(/location_code/);
    // The line above already says there are none: "Few results." would contradict it and
    // "No results." would merely repeat it. Assert the SENTENCE, not just that a hint exists —
    // an existence-only assertion stays green while the copy says something wrong (lesson 9).
    expect(text).not.toMatch(/few results/i);
    expect(text).toMatch(/This looked up the United States in English/);
  });

  /**
   * KARAR (a), 2026-08-08: name the TLD, never guess the location_code. Exactly two codes have
   * been measured on this stack (US 2840, TR 2792); a guessed third does not fail loudly, it
   * quietly returns another country's rankings. So the hint says ".tr domain" and stops — and
   * that matters most on the project_id path, where the caller never typed the domain at all.
   */
  it("names the country-code TLD of the resolved domain, without guessing its location code", () => {
    const text = formatRankedKeywords(
      result({
        target: "adstark.com.tr",
        total_count: 3,
        rows: [row({ keyword: "seo uzmani", position: 23, search_volume: 30 })],
      }),
      RENDER_INPUT,
    );
    expect(text).toContain("but adstark.com.tr is a .tr domain — a two-letter country-code TLD.");
    expect(text).toContain("If the site targets that country");
    // No invented code: 2792 is the measured Turkish code, and the hint must NOT hand it over
    // as if the tool knew the mapping. The hint carries NO digit at all — the only numbers in
    // the output are the caller's own echoed locale and the row figures, above it.
    // THE HINT BLOCK, not everything after it. The R-8.9 note is a separate block below the hint
    // and legitimately carries "12-month"; scanning to end-of-string would test that note's digits
    // instead of the hint's, which is not what this spec is about. The claim is unchanged: the
    // locale hint itself contains no digit, so it can hand over no guessed location code.
    const hint = text.slice(text.indexOf("Few results.")).split("\n\n")[0]!;
    expect(hint).toContain("country-code TLD");
    expect(hint).not.toMatch(/\d/);
  });

  it("does NOT claim a country-code TLD for a generic one", () => {
    const text = formatRankedKeywords(
      result({
        total_count: 1,
        rows: [row({ keyword: "thing", position: 40, search_volume: 10 })],
      }),
      RENDER_INPUT,
    );
    expect(text).toContain("This looked up the United States in English (the default).");
    expect(text).toContain("If the site targets another country");
    expect(text).not.toContain("country-code TLD");
  });

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    const text = formatRankedKeywords(
      result({
        target: "adstark.com.tr",
        total_count: 1,
        rows: [row({ keyword: "seo uzmani", position: 3, search_volume: 3600 })],
      }),
      { ...RENDER_INPUT, project: PROJECT },
    );
    expect(text).toContain('Ranked keywords for your project "adstark.com.tr"');
  });

  it("names the resolved PROJECT even when it ranks for nothing", () => {
    const text = formatRankedKeywords(
      result({ target: "adstark.com.tr", total_count: 0 }),
      { ...RENDER_INPUT, project: PROJECT },
    );
    expect(text).toContain(
      'No Google organic rankings on record for your project "adstark.com.tr"',
    );
  });

  it("does NOT invent a project for a bare-target lookup", () => {
    const text = formatRankedKeywords(
      result({ target: "competitor.example", total_count: 0 }),
      RENDER_INPUT,
    );
    expect(text).toContain('for "competitor.example"');
    expect(text).not.toContain("your project");
  });

  it("does NOT hint on an empty result when the locale was set explicitly", () => {
    const text = formatRankedKeywords(
      result({ target: "adstark.com.tr", total_count: 0 }),
      { language_code: "tr", location_code: 2792 },
    );
    expect(text).not.toMatch(/location_code/);
  });

  it("does NOT add the locale hint when the locale was set explicitly", () => {
    const text = formatRankedKeywords(
      result({
        target: "adstark.com.tr",
        total_count: 3,
        rows: [row({ keyword: "seo uzmani", position: 23, search_volume: 30 })],
      }),
      { language_code: "tr", location_code: 2792 },
    );
    expect(text).not.toMatch(/location_code/);
  });

  /**
   * The thinness test reads `total_count`, and falls back to `rows.length` when the vendor sent
   * none. Referee finding 2026-08-17: that fallback was UNMEASURED in BOTH directions — mutating
   * it to `?? 0` and to `?? 9999` each left all 83 test files green, so a vendor that omitted
   * total_count could have made a healthy 12-row result print a wrong-country warning, or
   * silenced the warning on a genuinely thin one, with nothing to catch it. Both directions are
   * pinned below. (The line predates this slice; the gap did too.)
   */
  it("uses the ROW COUNT for thinness when the vendor omitted total_count — a full page is not thin", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ keyword: `kw-${i}`, position: i + 1, search_volume: 100 }),
    );
    const text = formatRankedKeywords(result({ total_count: null, rows }), RENDER_INPUT);
    expect(text).not.toMatch(/location_code/);
    expect(text).not.toMatch(/Few results/);
  });

  it("still warns on a thin result when the vendor omitted total_count", () => {
    const text = formatRankedKeywords(
      result({ target: "adstark.com.tr", total_count: null, rows: [row({ keyword: "a", position: 23 })] }),
      RENDER_INPUT,
    );
    expect(text).toMatch(/Few results\./);
    expect(text).toMatch(/location_code/);
  });

  it("does NOT add the locale hint when the default locale returned plenty", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ keyword: `kw-${i}`, position: i + 1, search_volume: 100 }),
    );
    const text = formatRankedKeywords(result({ total_count: 12, rows }), RENDER_INPUT);
    expect(text).not.toMatch(/location_code/);
  });

  it("renders n/a for a missing position, volume, or URL", () => {
    const text = formatRankedKeywords(
      result({ total_count: 1, rows: [row({ keyword: "obscure term" })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("• obscure term — position n/a, volume n/a, n/a");
  });

  it("omits the 'of N' clause when nothing was truncated", () => {
    const text = formatRankedKeywords(
      result({
        total_count: 1,
        rows: [row({ keyword: "only one", position: 5, search_volume: 10, url: "https://example.com/" })],
      }),
      RENDER_INPUT,
    );
    expect(text).toContain("— 1 ranked keyword:");
    // THE HEADING LINE is where an "of N" clause would appear, so that is where its absence is
    // asserted. The R-8.9 note below the table is English prose and contains an ordinary " of ";
    // scanning the whole reply for the substring would fail on a sentence that is not a clause of
    // this heading at all.
    expect(text.split("\n")[0]!).not.toContain(" of ");
  });

  it("says so plainly when the domain ranks for nothing", () => {
    const text = formatRankedKeywords(
      result({ target: "nowhere.example", total_count: 0 }),
      RENDER_INPUT,
    );
    expect(text).toMatch(/no google organic rankings on record/i);
  });
});

/**
 * X1-a — `result.metrics.organic`. It arrives in the SAME paid response as the rows and was
 * parsed past and discarded: the domain's whole ranking distribution, its estimated traffic and
 * its movement since the vendor's last check, in one block.
 */
describe("formatRankedKeywords — the domain health card", () => {
  const FULL = metrics({
    pos_1: 4,
    pos_2_3: 11,
    pos_4_10: 92,
    pos_11_20: 240,
    pos_21_30: 410,
    pos_31_40: 520,
    pos_41_50: 630,
    pos_51_60: 700,
    pos_61_70: 740,
    pos_71_80: 760,
    pos_81_90: 780,
    pos_91_100: 425,
    etv: 15234.5,
    count: 5312,
    estimated_paid_traffic_cost: 48210.75,
    is_new: 128,
    is_up: 402,
    is_down: 517,
    is_lost: 96,
  });

  it("prints the card ABOVE the first keyword row, not after the table", () => {
    const text = formatRankedKeywords(
      result({ total_count: 5312, metrics: FULL, rows: [row({ keyword: "seo software" })] }),
      RENDER_INPUT,
    );
    expect(text.indexOf("Across the whole domain")).toBeGreaterThan(-1);
    expect(text.indexOf("Across the whole domain")).toBeLessThan(text.indexOf("• seo software"));
  });

  it("prints all TWELVE position bands, under compare_competitors' own labels", () => {
    const text = formatRankedKeywords(
      result({ metrics: FULL, rows: [row()] }),
      RENDER_INPUT,
    );
    expect(text).toContain(
      "- Organic SERPs by position, #1-20 — #1: 4 · #2-3: 11 · #4-10: 92 · #11-20: 240",
    );
    expect(text).toContain(
      "- Organic SERPs by position, #21-100 — #21-30: 410 · #31-40: 520 · #41-50: 630 · " +
        "#51-60: 700 · #61-70: 740 · #71-80: 760 · #81-90: 780 · #91-100: 425",
    );
  });

  it("labels the counted thing as SERPs and the modelled ones as estimates", () => {
    const text = formatRankedKeywords(result({ metrics: FULL, rows: [row()] }), RENDER_INPUT);
    expect(text).toContain("- Organic SERPs containing the domain: 5,312");
    expect(text).toContain("- Estimated monthly organic traffic (ETV): 15,235");
    expect(text).toContain("- Estimated monthly cost of the same traffic as paid ads: $48,211");
    expect(text).toContain(
      "- Since DataForSEO's previous check — newly ranking: 128 · moved up: 402 · " +
        "moved down: 517 · no longer found: 96",
    );
  });

  it("omits the card entirely when DataForSEO returned no metrics block", () => {
    const text = formatRankedKeywords(
      result({ total_count: 1, rows: [row({ keyword: "x", position: 4 })] }),
      RENDER_INPUT,
    );
    expect(text).not.toContain("Across the whole domain");
    expect(text).not.toContain("n/a ·");
  });

  it("prints n/a per missing field rather than dropping a card that has SOME data", () => {
    const text = formatRankedKeywords(
      result({ metrics: metrics({ count: 7 }), rows: [row()] }),
      RENDER_INPUT,
    );
    expect(text).toContain("- Organic SERPs containing the domain: 7");
    expect(text).toContain("#1: n/a");
    expect(text).toContain("- Estimated monthly organic traffic (ETV): n/a");
  });

  /**
   * "The vendor returned no rows" and "this domain ranks for nothing" are different claims. The
   * card is the evidence that tells them apart, so a zero-row result keeps it.
   */
  it("still prints the card when zero rows came back", () => {
    const text = formatRankedKeywords(
      result({ target: "example.com", total_count: 0, metrics: FULL }),
      RENDER_INPUT,
    );
    expect(text).toMatch(/no google organic rankings on record/i);
    expect(text).toContain("- Organic SERPs containing the domain: 5,312");
  });
});

/** X1-b — the per-row fields the response already carried and the projection threw away. */
describe("formatRankedKeywords — the per-row fields that were already paid for", () => {
  it.each([
    ["cpc", { cpc: 9.87 }, "CPC $9.87"],
    ["competition_level", { competition_level: "HIGH" }, "competition HIGH"],
    ["etv", { etv: 1180.4 }, "est. traffic 1,180/mo"],
  ] as const)("prints %s when the vendor sent it", (_name, override, expected) => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "seo software", ...override })] }),
      RENDER_INPUT,
    );
    expect(text).toContain(expected);
  });

  it.each(["CPC", "competition", "est. traffic"])(
    "OMITS %s rather than padding a thousand rows with n/a",
    (label) => {
      const text = formatRankedKeywords(
        result({ rows: [row({ keyword: "bare", position: 4, search_volume: 10 })] }),
        RENDER_INPUT,
      );
      expect(text).not.toContain(label);
      // ...while the fields that ALWAYS printed still print their n/a. Omission is the new
      // fields' rule, not a licence to drop the spine of the line.
      expect(text).toContain("• bare — position #4, volume 10, n/a");
    },
  );

  it("quotes the SERP title after the URL, and prints nothing when there is none", () => {
    const withTitle = formatRankedKeywords(
      result({
        rows: [
          row({ keyword: "seo software", url: "https://example.com/a", title: "SEO Software — Example" }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(withTitle).toContain('https://example.com/a — "SEO Software — Example"');
    const without = formatRankedKeywords(
      result({ rows: [row({ keyword: "seo software", url: "https://example.com/a" })] }),
      RENDER_INPUT,
    );
    const line = without.split("\n").find((l) => l.startsWith("• ")) ?? "";
    expect(line).toBe("• seo software — position n/a, volume n/a, https://example.com/a");
    expect(line).not.toContain('"');
  });

  it("orders the added fields after volume and before the URL", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          row({
            keyword: "seo software",
            position: 3,
            search_volume: 22200,
            cpc: 9.87,
            competition_level: "HIGH",
            etv: 1180.4,
            url: "https://example.com/a",
          }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(text).toContain(
      "• seo software — position #3, volume 22,200, CPC $9.87, competition HIGH, " +
        "est. traffic 1,180/mo, https://example.com/a",
    );
  });
});

/**
 * The five fields the operator's LIVE call (2026-08-17, moz.com) proved this endpoint returns and
 * the projection was discarding: keyword difficulty, search intent, per-keyword rank movement,
 * the SERP's other element types, and the check URL.
 */
describe("formatRankedKeywords — the live-measured fields", () => {
  it("prints difficulty and intent in research_keywords' own words", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          row({
            keyword: "seo software",
            keyword_difficulty: 26,
            main_intent: "commercial",
            foreign_intent: ["informational"],
          }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(text).toContain("difficulty 26/100");
    expect(text).toContain("intent commercial (also informational)");
  });

  it("omits the '(also …)' clause when there is no secondary intent", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", main_intent: "commercial" })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("intent commercial,");
    expect(text).not.toContain("also");
  });

  it.each(["difficulty", "intent"])("OMITS %s when the vendor sent none", (label) => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", position: 4, search_volume: 10 })] }),
      RENDER_INPUT,
    );
    expect(text).not.toContain(label);
  });

  /**
   * Movement is quoted on the ABSOLUTE scale, and says so. `previous_rank_absolute` beside an
   * organic "#3" without the words "on the page" invites a comparison the two scales do not
   * support — the very confusion the position line already exists to prevent.
   */
  it.each([
    [{ previous_rank_absolute: 18, is_new: false, is_up: false, is_down: true }, "moved down from #18 on the page"],
    [{ previous_rank_absolute: 29, is_new: false, is_up: true, is_down: false }, "moved up from #29 on the page"],
    [{ previous_rank_absolute: null, is_new: true, is_up: false, is_down: false }, "newly ranking"],
    [{ previous_rank_absolute: null, is_new: false, is_up: false, is_down: true }, "moved down"],
    [{ previous_rank_absolute: 12, is_new: false, is_up: false, is_down: false }, "previously #12 on the page"],
  ] as const)("renders movement case %#", (change, expected) => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", rank_change: change })] }),
      RENDER_INPUT,
    );
    expect(text).toContain(expected);
  });

  it("says nothing about movement when the change object carries no signal at all", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          row({
            keyword: "a",
            rank_change: { previous_rank_absolute: null, is_new: false, is_up: false, is_down: false },
          }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(text).not.toContain("moved");
    expect(text).not.toContain("newly ranking");
    expect(text).not.toContain("previously");
  });

  it("lists the SERP's OTHER element types, ai_overview included, and drops 'organic'", () => {
    const text = formatRankedKeywords(
      result({
        rows: [row({ keyword: "a", serp_item_types: ["organic", "ai_overview", "people_also_ask"] })],
      }),
      RENDER_INPUT,
    );
    expect(text).toContain("SERP also shows ai_overview, people_also_ask");
    // Every row here IS an organic ranking by construction; echoing it back says nothing.
    expect(text).not.toContain("shows organic");
  });

  it("says nothing about SERP features when organic is the ONLY element type", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", serp_item_types: ["organic"] })] }),
      RENDER_INPUT,
    );
    expect(text).not.toContain("SERP also shows");
  });

  it("offers the vendor's own check URL so the reader can verify the exact locale", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", check_url: "https://www.google.com/search?q=a&gl=US" })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("verify: https://www.google.com/search?q=a&gl=US");
  });

  /**
   * The context line is a SECOND line, and it exists only when it has content. A sparse row must
   * stay exactly one line — that is the whole reason these three fields were not appended to the
   * metrics spine.
   */
  it("adds a second, indented line carrying movement, features and the check link", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          row({
            keyword: "seo software",
            position: 25,
            absolute_position: 29,
            search_volume: 550000,
            rank_change: { previous_rank_absolute: 18, is_new: false, is_up: false, is_down: true },
            serp_item_types: ["organic", "ai_overview"],
            check_url: "https://g/?q=a",
            url: "https://example.com/a",
          }),
        ],
      }),
      RENDER_INPUT,
    );
    const lines = text.split("\n");
    const head = lines.findIndex((line) => line.startsWith("• seo software"));
    expect(lines[head]).toBe(
      "• seo software — position #25 organic (#29 on the page), volume 550,000, https://example.com/a",
    );
    expect(lines[head + 1]).toBe(
      "  moved down from #18 on the page · SERP also shows ai_overview · verify: https://g/?q=a",
    );
  });

  it("stays ONE line when the vendor sent no movement, no features and no check URL", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "bare", position: 4, search_volume: 10 })] }),
      RENDER_INPUT,
    );
    const lines = text.split("\n");
    const head = lines.findIndex((line) => line.startsWith("• bare"));
    expect(lines[head]).toBe("• bare — position #4, volume 10, n/a");
    expect(lines[head + 1] ?? "").not.toMatch(/^ {2}\S/);
  });

  /**
   * Two paid fields this slice deliberately does NOT print: `backlinks_info` and
   * `rank_info.page_rank`. analyze_backlinks is a whole 70-credit tool about exactly that
   * subject, and page_rank is a proprietary score that would need explaining on every appearance.
   * Pinned so the omission stays a decision rather than an oversight someone "fixes" silently.
   */
  it("does NOT restate analyze_backlinks' subject on every row", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", position: 3 })] }),
      RENDER_INPUT,
    );
    expect(text).not.toMatch(/backlink/i);
    expect(text).not.toMatch(/page.?rank/i);
  });
});

/**
 * X1-b, the rank decision. `rank_group` (organic rank) stays the headline; `rank_absolute` (rank
 * among ALL SERP elements) is printed only when it disagrees, because the disagreement is the
 * information — it says a SERP feature sits above this result.
 */
describe("formatRankedKeywords — rank_group vs rank_absolute", () => {
  it("names both when they disagree, and says which is which", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "seo software", position: 3, absolute_position: 4 })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("position #3 organic (#4 on the page)");
  });

  it("prints ONE number when they agree — the same figure twice is noise on every row", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "seo software", position: 3, absolute_position: 3 })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("position #3,");
    expect(text).not.toContain("on the page");
  });

  it("prints the organic rank alone when the vendor sent no absolute rank", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "seo software", position: 3 })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("position #3,");
    expect(text).not.toContain("on the page");
  });

  it("still reports the absolute rank when the organic one is missing", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "seo software", absolute_position: 4 })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("position n/a organic (#4 on the page)");
  });
});

/** The dead schema fields — `serp_item.type` and `result.items_count` — put to work. */
describe("formatRankedKeywords — the previously-unused vendor fields", () => {
  it("says nothing about the element type on an organic row (the request pins organic)", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "seo software", type: "organic" })] }),
      RENDER_INPUT,
    );
    expect(text).not.toContain("SERP element type");
  });

  it("calls out a row the vendor returned as something OTHER than organic", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "seo software", type: "featured_snippet" })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("SERP element type featured_snippet");
  });

  it("says how many returned rows were dropped for carrying no keyword", () => {
    const text = formatRankedKeywords(
      result({ total_count: 90, items_count: 3, rows: [row({ keyword: "a" })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("(2 returned rows carried no keyword and were dropped)");
  });

  it("says nothing when every returned row survived", () => {
    const text = formatRankedKeywords(
      result({ total_count: 90, items_count: 1, rows: [row({ keyword: "a" })] }),
      RENDER_INPUT,
    );
    expect(text).not.toContain("dropped");
  });
});

/**
 * X1-c — vendor freshness. The renderer is research_keywords' own (imported, not copied), so the
 * threshold and the sentence cannot drift between the two tools.
 */
describe("formatRankedKeywords — CPC/competition freshness", () => {
  const STAMP = "2026-07-15 09:00:00 +00:00";

  it("dates the CPC and competition figures it just printed", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", cpc: 9.87, last_updated_time: STAMP })] }),
      RENDER_INPUT,
      new Date("2026-07-20T00:00:00Z"),
    );
    expect(text).toContain("CPC and competition were last refreshed by DataForSEO on 2026-07-15");
    expect(text).toContain("(4 days ago)");
    expect(text).not.toContain("stale");
  });

  it("calls month-old vendor data stale, in a sentence", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", cpc: 9.87, last_updated_time: STAMP })] }),
      RENDER_INPUT,
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(text).toContain("This vendor data is stale");
  });

  it("reports the OLDEST row's stamp — a table is as fresh as its stalest row", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          row({ keyword: "fresh", last_updated_time: "2026-08-14 09:00:00 +00:00" }),
          row({ keyword: "stale", last_updated_time: STAMP }),
        ],
      }),
      RENDER_INPUT,
      new Date("2026-08-15T00:00:00Z"),
    );
    expect(text).toContain("on 2026-07-15");
    expect(text).not.toContain("on 2026-08-14");
  });

  it("drops the line entirely when no row carries a stamp", () => {
    const text = formatRankedKeywords(result({ rows: [row({ keyword: "a" })] }), RENDER_INPUT);
    expect(text).not.toContain("last refreshed");
  });

  it("drops the line rather than printing NaN for an unparseable vendor date", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "a", last_updated_time: "whenever" })] }),
      RENDER_INPUT,
    );
    expect(text).not.toContain("last refreshed");
    expect(text).not.toContain("NaN");
  });
});

/** X1-d — the header has to say WHICH "top N" the caller got. */
describe("formatRankedKeywords — the ordering the caller got", () => {
  it.each([
    ["volume", "highest search volume first"],
    ["traffic", "highest estimated traffic first"],
    ["position", "best ranking first"],
  ] as const)("names the '%s' ordering in the header", (sort, label) => {
    const text = formatRankedKeywords(
      result({ total_count: 5312, rows: [row({ keyword: "a" })] }),
      { ...RENDER_INPUT, sort },
    );
    expect(text).toContain(`1 ranked keyword of 5,312, ${label}:`);
  });

  it("says nothing about ordering when the caller's sort is unknown to the renderer", () => {
    const text = formatRankedKeywords(
      result({ total_count: 5312, rows: [row({ keyword: "a" })] }),
      RENDER_INPUT,
    );
    expect(text).toContain("1 ranked keyword of 5,312:");
  });
});

/**
 * X1-e — the two-letter test's false positives. `.io`, `.ai`, `.co` and friends are delegated
 * country-code TLDs that their registries sell worldwide; telling a `.io` SaaS to pass the
 * location code for "that country" is advice about the British Indian Ocean Territory.
 */
describe("formatRankedKeywords — generically-marketed two-letter TLDs", () => {
  const thin = (target: string): string =>
    formatRankedKeywords(
      result({ target, total_count: 2, rows: [row({ keyword: "a", position: 8 })] }),
      RENDER_INPUT,
    );

  it.each(["example.io", "example.ai", "example.co", "example.me", "example.tv"])(
    "does NOT call %s a country-code TLD",
    (target) => {
      const text = thin(target);
      expect(text).not.toContain("country-code TLD");
      expect(text).not.toContain(`is a .${target.split(".").pop()} domain`);
      // The actionable half of the hint survives — only the wrong claim is dropped.
      expect(text).toContain("This looked up the United States in English (the default).");
      expect(text).toContain("If the site targets another country");
    },
  );

  it.each(["adstark.com.tr", "beispiel.de", "exemple.fr"])(
    "still names %s's country-code TLD",
    (target) => {
      const tld = target.split(".").pop();
      expect(thin(target)).toContain(`but ${target} is a .${tld} domain — a two-letter country-code TLD.`);
    },
  );
});

/**
 * The pass-through the credit guard hides. `fetchAndRenderRankedKeywords` exists because the
 * handler's own path reserves credits (and therefore needs a database) BEFORE it touches the
 * port, so no fast-lane spec could see what it hands over. Measured blind spot, 34th mutation:
 * hard-coding the port's `sort` — discarding the caller's ordering on every live call — left all
 * 64 specs above green.
 */
describe("fetchAndRenderRankedKeywords — what the handler actually hands the port", () => {
  function recorder(): { port: RankedKeywordsPort; seen: RankedKeywordsQuery[] } {
    const seen: RankedKeywordsQuery[] = [];
    return {
      seen,
      port: {
        enabled: true,
        fetchRankedKeywords: async (query) => {
          seen.push(query);
          return result({ total_count: 5312, rows: [row({ keyword: "a" })] });
        },
      },
    };
  }

  it("forwards EVERY caller parameter, none of them defaulted or dropped", async () => {
    const { port, seen } = recorder();
    await fetchAndRenderRankedKeywords(
      port,
      { domain: "example.com", project: null },
      { target: "example.com", limit: 7, sort: "traffic", language_code: "tr", location_code: 2792 },
    );
    expect(seen).toEqual([
      {
        target: "example.com",
        limit: 7,
        sort: "traffic",
        language_code: "tr",
        location_code: 2792,
      },
    ]);
  });

  it("looks up the RESOLVED domain, not the raw target the caller typed", async () => {
    const { port, seen } = recorder();
    await fetchAndRenderRankedKeywords(
      port,
      { domain: "adstark.com.tr", project: PROJECT },
      { project_id: PROJECT_ID, limit: 5, sort: "volume", language_code: "en", location_code: 2840 },
    );
    expect(seen[0]?.target).toBe("adstark.com.tr");
  });

  it("gives the renderer the same sort it gave the port", async () => {
    const { port } = recorder();
    const { text } = await fetchAndRenderRankedKeywords(
      port,
      { domain: "example.com", project: null },
      { target: "example.com", limit: 5, sort: "position", language_code: "en", location_code: 2840 },
    );
    expect(text).toContain("best ranking first");
  });

  /**
   * ONE FETCH, TWO CONSUMERS. The handler needs the structural result to record the run (migration
   * 0027) and the text to reply with; a second call to the port for the second of those would be a
   * second PAID DataForSEO request and a second measurement that merely RESEMBLES the one the
   * caller was shown. So the vendor is asked exactly once, and the object handed back is the very
   * object that was rendered — identity, not a copy that could drift.
   */
  it("asks the vendor ONCE and returns the very result it rendered", async () => {
    const { port, seen } = recorder();
    const rendered = await fetchAndRenderRankedKeywords(
      port,
      { domain: "example.com", project: null },
      { target: "example.com", limit: 5, sort: "volume", language_code: "en", location_code: 2840 },
    );
    expect(seen).toHaveLength(1);
    expect(rendered.result.total_count).toBe(5312);
    expect(rendered.text).toBe(
      formatRankedKeywords(rendered.result, {
        language_code: "en",
        location_code: 2840,
        sort: "volume",
        project: null,
      }),
    );
  });

  it("names the project in the output when the target came from one", async () => {
    const { port } = recorder();
    const { text } = await fetchAndRenderRankedKeywords(
      port,
      { domain: "adstark.com.tr", project: PROJECT },
      { project_id: PROJECT_ID, limit: 5, sort: "volume", language_code: "en", location_code: 2840 },
    );
    expect(text).toContain('your project "adstark.com.tr"');
  });
});

describe("ranked_keywords metadata", () => {
  const tool = makeRankedKeywordsTool();

  it("advertises its name, the 65-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("ranked_keywords");
    expect(tool.description).toContain("Costs 65 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, { maximum?: number; minimum?: number; format?: string }>;
    };
    // NOTHING is required at the JSON-Schema level: the real rule is "exactly one of
    // project_id / target", which JSON Schema's `required` cannot express, so it is enforced
    // at runtime instead (see the free pre-reserve gates below, which pin BOTH directions).
    // Marking `target` required again would reject every project_id-only call in tools/list.
    expect(schema.required).toBeUndefined();
    expect(Object.keys(schema.properties).sort()).toEqual([
      "language_code",
      "limit",
      "location_code",
      "project_id",
      "sort",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
    // limit is bounded by what DataForSEO will return for one request.
    expect(schema.properties.limit?.minimum).toBe(1);
    expect(schema.properties.limit?.maximum).toBe(1000);
  });

  /**
   * The default is part of the PRICE of a call: DFS Labs bills per row, and the old default was
   * the vendor MAXIMUM, so every unqualified lookup bought 1000 rows nobody asked for.
   */
  it("defaults `limit` to a readable page rather than the vendor maximum", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { default?: unknown; enum?: string[] }>;
    };
    expect(schema.properties.limit?.default).toBe(DEFAULT_RANKED_KEYWORDS_LIMIT);
    expect(schema.properties.limit?.default).not.toBe(1000);
  });

  /**
   * `sort` is what makes `limit` mean "the top N". Without it the request carried no ordering and
   * the docs' own example — "show me the top 50 keywords" — returned an arbitrary 50.
   */
  it("offers the orderings the port can actually send, defaulting to search volume", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { default?: unknown; enum?: string[] }>;
    };
    expect(schema.properties.sort?.enum?.slice().sort()).toEqual(["position", "traffic", "volume"]);
    expect(schema.properties.sort?.default).toBe("volume");
  });

  it("rejects invalid input before any handler work", async () => {
    const result = await tool.run(CTX, { target: "example.com", limit: 5000 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });
});

describe("ranked_keywords free pre-reserve gates (no credit machinery)", () => {
  // Strip every SUPABASE var: if the tool tried to reserve, getServiceClient -> loadEnv
  // would throw the env error. A clean gate result therefore proves the short-circuit
  // happens BEFORE withCredits (zero ledger rows, NEVER #2).
  const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"] as const;
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("rejects a non-public domain without reaching the ledger", async () => {
    // A serving port is injected on purpose: the domain gate must fire FIRST, so even the
    // priced path never opens a reserve for input we could not look up.
    const tool = makeRankedKeywordsTool({ port: createMockRankedKeywordsPort(fixtureResponse) });
    const result = await tool.run(CTX, { target: "not a domain" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  /**
   * The project/target gates. All four run BEFORE the port is consulted and before withCredits,
   * so a serving port is injected deliberately: with SUPABASE_* stripped, any of them reaching
   * the reserve would throw the env error instead of returning cleanly.
   */
  const withProjects = (): ReturnType<typeof makeRankedKeywordsTool> =>
    makeRankedKeywordsTool({
      port: createMockRankedKeywordsPort(fixtureResponse),
      loadProject,
    });

  it("rejects a call naming NEITHER project_id nor target, without reaching the ledger", async () => {
    const result = await withProjects().run(CTX, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/nothing to look up/i);
    expect(result.content[0]?.text).toMatch(/not charged/i);
  });

  it("rejects a call naming BOTH, without reaching the ledger", async () => {
    const result = await withProjects().run(CTX, {
      project_id: PROJECT_ID,
      target: "competitor.example",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await withProjects().run(CTX, { project_id: OTHER_PROJECT_ID });
    const unknown = await withProjects().run(CTX, {
      project_id: "99999999-9999-4999-8999-999999999999",
    });
    expect(theirs.isError).toBe(true);
    expect(unknown.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
    // Same sentence up to the id the caller themselves supplied — no existence leak. Both came
    // back with SUPABASE_* stripped, which is the proof that neither reserved a credit.
    expect(theirs.content[0]?.text?.replace(OTHER_PROJECT_ID, "<id>")).toBe(
      unknown.content[0]?.text?.replace("99999999-9999-4999-8999-999999999999", "<id>"),
    );
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeRankedKeywordsTool({ port: disabledRankedKeywordsPort() });
    const result = await tool.run(CTX, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    // The error is the honesty gate, NOT a leaked env/DB failure.
    expect(result.content[0]?.text).not.toMatch(/environment|supabase/i);
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    // Complement of the gate proofs: with a valid domain and a serving port, run() must reach
    // withCredits -> reserve -> getServiceClient -> loadEnv, which throws because SUPABASE_*
    // are stripped. That is the seam where the 65 credits are settled.
    const tool = makeRankedKeywordsTool({ port: createMockRankedKeywordsPort(fixtureResponse) });
    await expect(tool.run(CTX, { target: "https://example.com/pricing" })).rejects.toThrow(
      /environment configuration/i,
    );
  });

  it("a RESOLVED project_id also reaches the credit guard — the gates are not a dead end", async () => {
    // The complement of the three rejections above: a project the caller owns passes every gate
    // and lands on the same priced path a bare target does. The ledger shape of that path is
    // proven against the real stack in ranked-keywords.db.test.ts.
    await expect(withProjects().run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});

// =============================================================================================
// S1 — ABSENT IS NOT ZERO, PROVEN FROM THE VENDOR BODY AND NOT FROM A HAND-BUILT ROW.
//
// Every spec above builds a RankedKeywordRow directly, so the zod projection in
// dfs/ranked-keywords.ts — the only place a zero could be invented — was never under test from
// this side. These run the REAL parser over a body shaped like the one measured 2026-08-25
// (dentnotion.com, tr/Türkiye), where `keyword_properties` carried `detected_language` alone and
// `keyword_difficulty` was NOT among its keys.
//
// TWO fields, two conventions, both deliberate and both pinned here:
//   - a ROW field (`keyword_difficulty`) is OMITTED when absent, exactly as `cpc` already is —
//     the rule the "OMITS %s" specs above established, so a hundred rows are not padded with n/a;
//   - a HEALTH-CARD field (`is_lost`) is a fixed line, so it prints the word "n/a".
// Either way the output distinguishes "the vendor did not say" from "the vendor said zero", which
// is the whole claim; a 0 in place of a silence is a number the reader will act on.
// =============================================================================================

/** The measured item shape, with the two keys under test supplied by each spec. */
function rankedItem(overrides: {
  readonly keyword_properties: Record<string, unknown>;
}): unknown {
  return {
    keyword_data: {
      keyword: "diş taşı temizliğinden sonra yemek yenir mi",
      location_code: 2792,
      language_code: "tr",
      keyword_info: {
        se_type: "google",
        last_updated_time: "2026-08-01 00:00:00 +00:00",
        competition_level: "LOW",
        search_volume: 480,
      },
      keyword_properties: overrides.keyword_properties,
    },
    ranked_serp_element: {
      serp_item: { type: "organic", rank_group: 3, rank_absolute: 4, url: "https://dentnotion.com/a" },
    },
  };
}

/** A ranked_keywords envelope carrying one item and, optionally, a metrics block. */
function rankedEnvelope(item: unknown, organic?: Record<string, unknown>): unknown {
  return {
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            target: "dentnotion.com",
            total_count: 1,
            items_count: 1,
            ...(organic === undefined ? {} : { metrics: { organic } }),
            items: [item],
          },
        ],
      },
    ],
  };
}

/** Parse a whole body through the real parser and render it, exactly as the handler does. */
function renderedFromBody(raw: unknown): string {
  return formatRankedKeywords(parseRankedKeywordsResponse(raw), {
    language_code: "tr",
    location_code: 2792,
  });
}

/** The four movement counters, minus the one key each spec is about. */
const MOVEMENT_WITHOUT_IS_LOST = { count: 6, is_new: 89, is_up: 57, is_down: 41 };

describe("S1 — a field absent from the vendor body never becomes a 0", () => {
  it("omits difficulty when keyword_properties carries no keyword_difficulty key", () => {
    const text = renderedFromBody(
      rankedEnvelope(rankedItem({ keyword_properties: { se_type: "google", detected_language: "tr" } })),
    );
    expect(text).not.toMatch(/difficulty/i);
    // …while the row itself is intact: the omission is one field, not a degraded line.
    expect(text).toContain("position #3 organic (#4 on the page), volume 480, competition LOW");
  });

  it("prints difficulty 0/100 when the vendor reports the difficulty AS 0", () => {
    const text = renderedFromBody(
      rankedEnvelope(
        rankedItem({
          keyword_properties: { se_type: "google", detected_language: "tr", keyword_difficulty: 0 },
        }),
      ),
    );
    expect(text).toContain("difficulty 0/100");
  });

  it("prints 'no longer found: n/a' when the metrics block carries no is_lost key", () => {
    const text = renderedFromBody(
      rankedEnvelope(
        rankedItem({ keyword_properties: { se_type: "google", detected_language: "tr" } }),
        MOVEMENT_WITHOUT_IS_LOST,
      ),
    );
    expect(text).toContain(
      "newly ranking: 89 · moved up: 57 · moved down: 41 · no longer found: n/a",
    );
  });

  it("prints 'no longer found: 0' when the vendor reports is_lost AS 0", () => {
    const text = renderedFromBody(
      rankedEnvelope(
        rankedItem({ keyword_properties: { se_type: "google", detected_language: "tr" } }),
        { ...MOVEMENT_WITHOUT_IS_LOST, is_lost: 0 },
      ),
    );
    expect(text).toContain(
      "newly ranking: 89 · moved up: 57 · moved down: 41 · no longer found: 0",
    );
  });
});

// =============================================================================================
// S19 — WHICH DataForSEO MEASUREMENT THE HEALTH CARD IS.
//
// The card is this tool's own `result.metrics.organic`, arriving in the SAME paid response as the
// rows. compare_competitors prints the identical nineteen fields under identical labels from
// competitors_domain or domain_rank_overview — separate DataForSEO measurements of the same
// domain, which disagree (this fixture's `is_lost` is 96; competitors-domain.json says 319 and
// domain-rank-overview.json says 547 for the same domain). Under one unnamed heading that read as
// the product contradicting itself. Forcing the numbers to agree would fabricate one of them, so
// the heading names the measurement instead.
//
// Both specs drive the REAL parser into the REAL renderer: asserting against a metrics object
// built in the test would prove nothing about which vendor key was read (lesson 12).
// =============================================================================================

/** A ranked_keywords envelope carrying a whole `metrics` block — organic plus any siblings. */
function rankedEnvelopeWithMetrics(metricsBlock: Record<string, unknown>): unknown {
  return {
    status_code: 20000,
    tasks: [
      {
        status_code: 20000,
        result: [
          {
            target: "dentnotion.com",
            total_count: 1,
            items_count: 1,
            metrics: metricsBlock,
            items: [rankedItem({ keyword_properties: { se_type: "google" } })],
          },
        ],
      },
    ],
  };
}

describe("S19 — the health card names the DataForSEO measurement it came from", () => {
  it("names ranked keywords — and neither of the endpoints compare_competitors reads", () => {
    const text = formatRankedKeywords(parseRankedKeywordsResponse(fixtureResponse), RENDER_INPUT);
    expect(text).toContain(
      "Across the whole domain — every keyword it ranks for, from DataForSEO's ranked-keywords data:\n" +
        "- Organic SERPs containing the domain: 5,312",
    );
    // 96 is THIS response's figure. The other two measurements of the same domain say 319 and 547
    // in this repo's own fixtures; claiming either name here would misattribute a real number.
    expect(text).toContain("no longer found: 96");
    expect(text).not.toContain("DataForSEO's competitor-discovery data");
    expect(text).not.toContain("DataForSEO's domain-overview data");
  });

  /**
   * The card is `metrics.organic` specifically, not "whichever block `metrics` happens to hold".
   * The sibling below is modelled on domain-rank-overview.json, which carries a `metrics.paid`
   * beside its organic one; whether ranked_keywords returns one is NOT claimed here — the spec is
   * about which key OUR parser reads when more than one is present.
   *
   * Mutation proof: re-point projectOrganicMetrics at `metrics.paid` and the card prints 4,242
   * lost rankings under a heading that says ranked keywords.
   */
  it("reads the ORGANIC block, never a sibling block sitting beside it", () => {
    const text = formatRankedKeywords(
      parseRankedKeywordsResponse(
        rankedEnvelopeWithMetrics({
          organic: { count: 5312, is_new: 128, is_up: 402, is_down: 517, is_lost: 96 },
          paid: { count: 11, is_new: 2, is_up: 11, is_down: 3, is_lost: 4242 },
        }),
      ),
      RENDER_INPUT,
    );
    expect(text).toContain("- Organic SERPs containing the domain: 5,312");
    expect(text).toContain("no longer found: 96");
    expect(text).not.toContain("4,242");
    expect(text).not.toContain("- Organic SERPs containing the domain: 11");
  });

  it("prints the measurement note ONCE, below the figures the card just stated", () => {
    const text = formatRankedKeywords(parseRankedKeywordsResponse(fixtureResponse), RENDER_INPUT);
    expect(text.split(WHOLE_DOMAIN_MEASUREMENT_NOTE)).toHaveLength(2);
    expect(text.indexOf(WHOLE_DOMAIN_MEASUREMENT_NOTE)).toBeGreaterThan(
      text.indexOf("Organic SERPs containing the domain"),
    );
  });

  it("carries no note when the vendor sent no metrics block — nothing to attribute", () => {
    const text = formatRankedKeywords(
      parseRankedKeywordsResponse(rankedEnvelope(rankedItem({ keyword_properties: {} }))),
      RENDER_INPUT,
    );
    expect(text).not.toContain("Across the whole domain");
    expect(text).not.toContain(WHOLE_DOMAIN_MEASUREMENT_NOTE);
  });
});

/**
 * S23.1' — THE FLAT-ZERO READING NOTES (signed 2026-08-26, 0 credits; scope widened 2026-08-26
 * after a judge probe found the signal bound to ONE column while three others went unremarked).
 *
 * Measured on the live walkthrough: 10/10 and then 6/6 ranked keywords came back at
 * `difficulty 0/100` on volumes of 2,400-14,800. The parsing was NOT at fault — a 0 reaches the
 * reader only when DataForSEO sent a 0, and the vendor's own dedicated endpoint proves the field
 * works and varies in that market. What the reader still gets is a column with no signal in it
 * that reads as a measurement.
 *
 * EVERY per-row numeric column this table prints is bound: `volume`, `CPC`, `difficulty` and
 * `est. traffic`. See FLAT_ZERO_COLUMNS in the source for the four exclusions and the measurement
 * behind each, and format/flat-zero.ts for the sentence these notes are forbidden to become.
 */
describe("S23.1' — the flat-zero notes on ranked_keywords", () => {
  const FLAT = 'READ THIS FLAT COLUMN AS "NO SIGNAL"';
  /** Which columns spoke, in the order they spoke. Read from the notes, never assumed. */
  const notedColumns = (text: string): string[] =>
    [...text.matchAll(/DataForSEO reported (.+?) 0 for every one of/g)].map((m) => m[1]!);

  const zeroRow = (keyword: string, position: number, over: Partial<RankedKeywordRow> = {}) =>
    row({ keyword, position, search_volume: 14800, keyword_difficulty: 0, ...over });

  it("(a) ONE flat column speaks, and only that one", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          zeroRow("dis teli", 4, { cpc: 3.2, etv: 900 }),
          zeroRow("zirkonyum dis", 7, { search_volume: 8100, cpc: 1.1, etv: 120 }),
          zeroRow("dis beyazlatma", 11, { search_volume: 6600, cpc: 0.4, etv: 60 }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(notedColumns(text)).toEqual(["difficulty"]);
    expect(text.split(FLAT).length - 1).toBe(1);
    expect(text).toContain("every one of the 3 keywords above");
  });

  it("(b) TWO flat columns speak TWICE, in the order the row prints them", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          zeroRow("dis teli", 4, { cpc: 0, etv: 900 }),
          zeroRow("zirkonyum dis", 7, { search_volume: 8100, cpc: 0, etv: 120 }),
        ],
      }),
      RENDER_INPUT,
    );
    // CPC is printed BEFORE difficulty on the row, so its note comes first.
    expect(notedColumns(text)).toEqual(["CPC", "difficulty"]);
    expect(text.split(FLAT).length - 1).toBe(2);
  });

  it("(c) THREE flat columns speak three times, still in print order", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          zeroRow("dis teli", 4, { search_volume: 0, cpc: 0, etv: 900 }),
          zeroRow("zirkonyum dis", 7, { search_volume: 0, cpc: 0, etv: 120 }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(notedColumns(text)).toEqual(["volume", "CPC", "difficulty"]);
  });

  it("(c) all FOUR bound columns can speak at once", () => {
    const flatEverything = { search_volume: 0, cpc: 0, keyword_difficulty: 0, etv: 0 } as const;
    const text = formatRankedKeywords(
      result({
        rows: [
          row({ keyword: "dis teli", position: 4, ...flatEverything }),
          row({ keyword: "zirkonyum dis", position: 7, ...flatEverything }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(notedColumns(text)).toEqual(["volume", "CPC", "difficulty", "est. traffic"]);
    // `est. traffic` is the one column with no non-English capture behind it, so ITS note — and
    // only its note — withholds the claim about the vendor's other lookups.
    const traffic = text.slice(text.lastIndexOf(FLAT));
    expect(traffic).toContain("est. traffic");
    expect(traffic).not.toContain("non-English markets");
    expect(text.slice(0, text.lastIndexOf(FLAT))).toContain("non-English markets");
  });

  it("(d) NOTHING is said when no column is flat", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          row({ keyword: "dis teli", position: 4, search_volume: 14800, cpc: 3.2, keyword_difficulty: 0, etv: 900 }),
          row({ keyword: "implant dis fiyatlari", position: 9, search_volume: 2400, cpc: 1.1, keyword_difficulty: 12, etv: 120 }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(text).not.toContain(FLAT);
    expect(text).toContain("difficulty 0/100");
    expect(text).toContain("difficulty 12/100");
  });

  it("says NOTHING on a single row — one value never varied from anything", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "dis teli", position: 4, search_volume: 0, cpc: 0, keyword_difficulty: 0, etv: 0 })] }),
      RENDER_INPUT,
    );
    expect(text).not.toContain(FLAT);
    expect(text).toContain("difficulty 0/100");
  });

  it("a null row neither breaks a column's pattern nor counts toward it", () => {
    const text = formatRankedKeywords(
      result({
        rows: [
          zeroRow("dis teli", 4),
          row({ keyword: "ortodonti", position: 22 }),
          zeroRow("dis beyazlatma", 11, { search_volume: 6600 }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(notedColumns(text)).toEqual(["difficulty"]);
    // TWO, not three: the silent row is not evidence of a zero and is not counted as one.
    expect(text).toContain("every one of the 2 keywords above");
    const silent = text.split("\n").find((line) => line.startsWith("• ortodonti")) ?? "";
    expect(silent).not.toContain("difficulty");
  });

  it("does NOT suppress or rewrite the zeros it is talking about", () => {
    const text = formatRankedKeywords(
      result({ rows: [zeroRow("dis teli", 4), zeroRow("zirkonyum dis", 7, { search_volume: 8100 })] }),
      RENDER_INPUT,
    );
    expect(text.split("difficulty 0/100").length - 1).toBe(2);
    expect(text).not.toContain("difficulty not reported");
  });

  /**
   * WHY `position` AND THE HEALTH CARD ARE NOT BOUND — the S23 decision file's §4.3 claimed the
   * signal already covered `rank 0` and `is_lost: 0`, and it does not. `rank_group` is 1-based, so
   * a flat zero is not a value the scale can carry; `is_lost` is ONE number for the whole answer,
   * and "it never varied across the rows" cannot be said of a single value. Both are narrowed to
   * "not covered" in the source and in the decision file, and this pins that they stay uncovered.
   */
  it("never speaks about position or about a health-card figure", () => {
    const text = formatRankedKeywords(
      result({
        metrics: metrics({ count: 3, is_lost: 0, is_new: 0, is_up: 0, is_down: 0, etv: 0 }),
        rows: [
          row({ keyword: "dis teli", position: 4, search_volume: 14800, keyword_difficulty: 0 }),
          row({ keyword: "zirkonyum dis", position: 7, search_volume: 8100, keyword_difficulty: 0 }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(notedColumns(text)).toEqual(["difficulty"]);
    expect(text).not.toMatch(/DataForSEO reported (position|is_lost|is_new) 0/);
    // ...while the card itself still prints those zeros exactly as it always did.
    expect(text).toContain("no longer found: 0");
  });

  it("claims no CAUSE for the zeros at the surface either", () => {
    const text = formatRankedKeywords(
      result({ rows: [zeroRow("dis teli", 4), zeroRow("zirkonyum dis", 7, { search_volume: 8100 })] }),
      RENDER_INPUT,
    );
    const note = text.slice(text.indexOf(FLAT));
    for (const claim of [/\bplans?\b/i, /\bunavailable\b/i, /\bnot available\b/i, /\babsent\b/i]) {
      expect(note, `the note claims a cause matching ${claim}`).not.toMatch(claim);
    }
  });

  it("keeps the notes in English (imzali ders 4)", () => {
    const flatEverything = { search_volume: 0, cpc: 0, keyword_difficulty: 0, etv: 0 } as const;
    const text = formatRankedKeywords(
      result({
        rows: [
          row({ keyword: "kw one", position: 4, ...flatEverything }),
          row({ keyword: "kw two", position: 7, ...flatEverything }),
        ],
      }),
      RENDER_INPUT,
    );
    expect(text.slice(text.indexOf(FLAT))).not.toMatch(/[çğışöüÇĞİŞÖÜ]/);
  });
});

/**
 * R-8.9 — the shared search-volume note (finding B-3). `ranked_keywords` prints the vendor's
 * `search_volume` on every row, so it prints the disclosure; it does NOT print the BAND half,
 * because its rows are ordered by whatever `sort` the caller chose (or the vendor's own default),
 * not by this figure — a band sentence here would describe an ordering the tool does not make.
 */
describe("ranked_keywords — the shared search-volume note (R-8.9)", () => {
  it("prints the shared note under a populated table", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "kw", search_volume: 30 })] }),
      RENDER_INPUT,
    );
    expect(text).toContain(SEARCH_VOLUME_NOTE);
    expect(text).toMatch(/close variants/i);
    expect(text).toMatch(/12[- ]month/i);
  });

  it("carries the clause in the tool description too", () => {
    const description = makeRankedKeywordsTool().description;
    expect(description).toContain(SEARCH_VOLUME_DESCRIPTION_CLAUSE);
    expect(description).toMatch(/close variants/i);
  });

  it("does NOT claim a band ordering it never applies", () => {
    const text = formatRankedKeywords(
      result({ rows: [row({ keyword: "kw", search_volume: 30 })] }),
      RENDER_INPUT,
    );
    expect(text).not.toContain(SEARCH_VOLUME_BAND_NOTE);
  });
});
