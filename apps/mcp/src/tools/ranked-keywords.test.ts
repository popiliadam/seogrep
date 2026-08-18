import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  DEFAULT_RANKED_KEYWORDS_LIMIT,
  createMockRankedKeywordsPort,
  disabledRankedKeywordsPort,
  type RankedKeywordRow,
  type RankedKeywordsPort,
  type RankedKeywordsQuery,
  type RankedKeywordsResult,
} from "../dfs/ranked-keywords.ts";
import { EMPTY_ORGANIC_METRICS, type DomainOrganicMetrics } from "../dfs/competitors.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import {
  fetchAndRenderRankedKeywords,
  formatRankedKeywords,
  makeRankedKeywordsTool,
} from "./ranked-keywords.ts";
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
    expect(text).toBe(
      'Ranked keywords for "example.com" (language en, location 2840) — 2 ranked keywords of 5,312:\n' +
        "• seo software — position #3, volume 22,200, https://example.com/seo-software\n" +
        "• rank tracker — position #18, volume 8,100, https://example.com/rank-tracker",
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
    const hint = text.slice(text.indexOf("Few results."));
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
    expect(text).not.toContain(" of ");
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
    const text = await fetchAndRenderRankedKeywords(
      port,
      { domain: "example.com", project: null },
      { target: "example.com", limit: 5, sort: "position", language_code: "en", location_code: 2840 },
    );
    expect(text).toContain("best ranking first");
  });

  it("names the project in the output when the target came from one", async () => {
    const { port } = recorder();
    const text = await fetchAndRenderRankedKeywords(
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
