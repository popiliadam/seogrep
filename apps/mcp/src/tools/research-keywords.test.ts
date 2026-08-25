import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockResearchPort,
  disabledPort,
  parseKeywordOverviewResponse,
  type KeywordOverviewRow,
} from "../dfs/client.ts";
import { STALE_PULL_DAYS } from "../gsc-data/load.ts";
import {
  formatKeywordOverview,
  isUnansweredLookup,
  makeResearchKeywordsTool,
  missingKeywords,
  parseDfsTimestamp,
  renderVendorFreshness,
} from "./research-keywords.ts";
import fixtureResponse from "../dfs/fixtures/keyword-overview.json";
import trFixture from "../dfs/fixtures/keyword-overview-tr.json";
import trEmptyFixture from "../dfs/fixtures/keyword-overview-tr-empty.json";

/**
 * Fast-lane (DB-less) proofs for research_keywords. The credit LEDGER behaviour (mock ->
 * reserve+commit; disabled -> zero rows) is proven against the real stack in
 * research-keywords.db.test.ts. Here we prove: the pure formatter, the tool metadata, and
 * — critically — that the live-DISABLED path returns its error WITHOUT touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

/** A row with every Labs-only metric absent — i.e. exactly what the retired endpoint supplied. */
function classicRow(fields: Partial<KeywordOverviewRow> & { keyword: string }): KeywordOverviewRow {
  return {
    search_volume: null,
    cpc: null,
    competition_level: null,
    competition: null,
    keyword_difficulty: null,
    main_intent: null,
    foreign_intent: [],
    search_volume_trend: null,
    last_updated_time: null,
    has_data: true,
    ...fields,
  };
}

/**
 * The formatter's input. `keywords` is what the CALLER asked about, and since the formatter now
 * accounts for every one of them (missingKeywords), each spec below names the keywords its own
 * rows answer instead of the placeholder pair this const used to carry. No expectation in this
 * file changed for that; the strings asserted are byte-identical to the ones asserted before.
 */
const INPUT = { keywords: ["seo software", "rank tracker"], language_code: "en", location_code: 2840 };
/** INPUT for a spec whose rows answer a single keyword. */
const asked = (...keywords: string[]) => ({ ...INPUT, keywords });
const NOW = new Date("2026-08-17T12:00:00.000Z");

describe("formatKeywordOverview — the OUTPUT CONTRACT the endpoint switch had to preserve", () => {
  /**
   * Byte-for-byte the string research_keywords returned before the vendor endpoint moved from
   * keywords_data/google_ads/search_volume to dataforseo_labs/keyword_overview. This tool is
   * live and charges 25 credits a call; the volume/CPC/competition line is what the user pays
   * for, and it must be reachable in the same words, in the same order, from the new vendor
   * shape. Everything the switch ADDED appears only when the vendor sends it (specs below).
   */
  it("renders the pre-switch keyword table byte-for-byte when only the classic metrics exist", () => {
    const rows = [
      classicRow({ keyword: "seo software", search_volume: 22200, cpc: 9.87, competition_level: "HIGH" }),
      classicRow({ keyword: "rank tracker", search_volume: 8100, cpc: 4.1, competition_level: "LOW" }),
    ];
    expect(formatKeywordOverview(rows, INPUT, NOW)).toBe(
      "Search volume for 2 keywords (language en, location 2840), 30,300 total monthly searches:\n" +
        "• seo software — volume 22,200, CPC $9.87, competition HIGH\n" +
        "• rank tracker — volume 8,100, CPC $4.10, competition LOW",
    );
  });

  it("renders n/a for null metrics on a keyword the vendor DOES hold data for", () => {
    const text = formatKeywordOverview(
      [classicRow({ keyword: "obscure term", cpc: null, has_data: true })],
      { ...INPUT, keywords: ["obscure term"] },
      NOW,
    );
    expect(text).toContain("• obscure term — volume n/a, CPC n/a, competition n/a");
  });

  it("returns a friendly message when there are no rows", () => {
    const text = formatKeywordOverview([], INPUT, NOW);
    expect(text).toMatch(/no search-volume data/i);
  });

  it("says '1 keyword', not '1 keywords', for a single-keyword lookup", () => {
    // The one-row header is its own branch and reads as broken English if it is missed. The
    // plural side is pinned by the byte-for-byte spec above, so both sides are measured.
    const text = formatKeywordOverview(
      [classicRow({ keyword: "seo software", search_volume: 100 })],
      { ...INPUT, keywords: ["seo software"] },
      NOW,
    );
    expect(text.startsWith("Search volume for 1 keyword (language en, location 2840), ")).toBe(true);
    expect(text).not.toContain("for 1 keywords");
  });
});

/**
 * What happens when the SAME keyword comes back twice.
 *
 * We do not know whether DataForSEO's keyword_overview endpoint ever does this — the operator
 * A/B (2026-08-17) sent five distinct keywords and got five distinct rows, so the case has
 * never been observed. That is precisely why the CURRENT behaviour is pinned rather than
 * "fixed": inventing a silent de-duplication would delete a row the vendor actually sent, on a
 * hunch about an endpoint nobody has seen misbehave, in a tool the user pays 25 credits to
 * read. If a duplicate is ever observed live, THIS spec is where the decision gets revisited —
 * with evidence instead of a guess.
 */
describe("formatKeywordOverview — a repeated keyword is passed through, not silently deduped", () => {
  const duplicated = [
    classicRow({ keyword: "seo software", search_volume: 22200, cpc: 9.87, competition_level: "HIGH" }),
    classicRow({ keyword: "seo software", search_volume: 22200, cpc: 9.87, competition_level: "HIGH" }),
  ];

  it("renders BOTH rows rather than collapsing them", () => {
    const lines = formatKeywordOverview(duplicated, asked("seo software"), NOW).split("\n");
    expect(lines.filter((line) => line.startsWith("• seo software —"))).toHaveLength(2);
  });

  it("counts the repeat in the header and in the total, exactly as the vendor sent it", () => {
    expect(formatKeywordOverview(duplicated, asked("seo software"), NOW)).toContain(
      "Search volume for 2 keywords (language en, location 2840), 44,400 total monthly searches:",
    );
  });
});

describe("formatKeywordOverview — no data is NOT zero volume", () => {
  /** The caller asked about exactly the three keywords these rows answer. */
  const ASKED_THREE = asked("seo software", "nobody searches this", "backlink checker");
  const rows = [
    classicRow({ keyword: "seo software", search_volume: 22200, cpc: 9.87, competition_level: "HIGH" }),
    classicRow({ keyword: "nobody searches this", search_volume: 0, cpc: 0, competition_level: "LOW" }),
    classicRow({ keyword: "backlink checker", has_data: false }),
  ];

  it("says a no-data keyword returned NO DATA, and never prints it as volume 0", () => {
    const text = formatKeywordOverview(rows, ASKED_THREE, NOW);
    expect(text).toContain("• backlink checker — no data returned for this keyword");
    expect(text).not.toContain("• backlink checker — volume 0");
    expect(text).not.toContain("• backlink checker — volume n/a");
  });

  it("still prints a genuine ZERO volume as a number, because that is a real measurement", () => {
    expect(formatKeywordOverview(rows, ASKED_THREE, NOW)).toContain(
      "• nobody searches this — volume 0, CPC $0.00, competition LOW",
    );
  });

  it("counts the no-data keywords out loud in the header instead of silently averaging them in", () => {
    const text = formatKeywordOverview(rows, ASKED_THREE, NOW);
    expect(text).toContain("22,200 total monthly searches (1 keyword returned no data):");
    const many = formatKeywordOverview(
      [...rows, classicRow({ keyword: "another unknown", has_data: false })],
      ASKED_THREE,
      NOW,
    );
    expect(many).toContain("(2 keywords returned no data)");
  });

  it("says nothing about missing data when every keyword was answered", () => {
    const text = formatKeywordOverview([rows[0] as KeywordOverviewRow], asked("seo software"), NOW);
    expect(text).not.toMatch(/returned no data/);
  });
});

describe("formatKeywordOverview — the three metrics the Labs endpoint added", () => {
  it("prints keyword difficulty on a 0–100 scale", () => {
    const text = formatKeywordOverview(
      [classicRow({ keyword: "seo software", search_volume: 100, keyword_difficulty: 61 })],
      asked("seo software"),
      NOW,
    );
    expect(text).toContain("difficulty 61/100");
  });

  it("prints the main intent, and names secondary intents when the vendor reports them", () => {
    const withForeign = formatKeywordOverview(
      [
        classicRow({
          keyword: "seo software",
          search_volume: 100,
          main_intent: "commercial",
          foreign_intent: ["informational", "transactional"],
        }),
      ],
      asked("seo software"),
      NOW,
    );
    expect(withForeign).toContain("intent commercial (also informational, transactional)");

    const soleIntent = formatKeywordOverview(
      [classicRow({ keyword: "seo software", search_volume: 100, main_intent: "navigational" })],
      asked("seo software"),
      NOW,
    );
    expect(soleIntent).toContain("intent navigational");
    expect(soleIntent).not.toContain("also");
  });

  it("prints the volume trend SIGNED, and omits the legs the vendor did not send", () => {
    const text = formatKeywordOverview(
      [
        classicRow({
          keyword: "seo software",
          search_volume: 100,
          search_volume_trend: { monthly: 12, quarterly: null, yearly: -45 },
        }),
      ],
      asked("seo software"),
      NOW,
    );
    expect(text).toContain("trend +12% MoM, -45% YoY");
    expect(text).not.toContain("QoQ");
  });

  it("omits each added metric entirely when the vendor sent none of it", () => {
    const text = formatKeywordOverview(
      [classicRow({ keyword: "seo software", search_volume: 100, cpc: 1, competition_level: "LOW" })],
      asked("seo software"),
      NOW,
    );
    expect(text).not.toContain("difficulty");
    expect(text).not.toContain("intent");
    expect(text).not.toContain("trend");
  });
});

describe("parseDfsTimestamp", () => {
  it("reads DataForSEO's non-ISO 'YYYY-MM-DD HH:MM:SS +00:00' timestamp as UTC", () => {
    expect(parseDfsTimestamp("2026-06-14 08:12:33 +00:00")).toBe(
      Date.parse("2026-06-14T08:12:33.000Z"),
    );
  });

  it("returns null for anything it cannot read, so a bad date drops the LINE, not the table", () => {
    expect(parseDfsTimestamp("not a date")).toBeNull();
    expect(parseDfsTimestamp("")).toBeNull();
  });
});

describe("renderVendorFreshness — the CPC honesty line", () => {
  const daysBefore = (days: number): string => {
    const at = new Date(NOW.getTime() - days * 86_400_000);
    return `${at.toISOString().slice(0, 10)} 08:00:00 +00:00`;
  };

  it("dates the CPC figures with the vendor's own last_updated_time", () => {
    const text = renderVendorFreshness(
      [classicRow({ keyword: "k", last_updated_time: "2026-08-10 08:12:33 +00:00" })],
      NOW,
    );
    expect(text).toBe("CPC and competition were last refreshed by DataForSEO on 2026-08-10 (7 days ago).");
  });

  it("reports the OLDEST timestamp in the batch, not the most flattering one", () => {
    const text = renderVendorFreshness(
      [
        classicRow({ keyword: "fresh", last_updated_time: daysBefore(1) }),
        classicRow({ keyword: "old", last_updated_time: daysBefore(9) }),
      ],
      NOW,
    );
    expect(text).toContain("9 days ago");
    expect(text).not.toContain("1 day ago");
  });

  /**
   * The age phrase has three branches — "today", "1 day ago", "N days ago" — and only the
   * third was measured. The singular one is the branch that turns into "1 days ago" the moment
   * anyone simplifies the expression, and nothing else in the suite would notice.
   */
  it("says 'today' when the vendor refreshed within the day", () => {
    const text = renderVendorFreshness([classicRow({ keyword: "k", last_updated_time: daysBefore(0) })], NOW);
    expect(text).toContain("(today).");
    expect(text).not.toContain("0 days ago");
  });

  it("says '1 day ago', not '1 days ago', at exactly one day", () => {
    const text = renderVendorFreshness([classicRow({ keyword: "k", last_updated_time: daysBefore(1) })], NOW);
    expect(text).toContain("(1 day ago).");
    expect(text).not.toContain("1 days ago");
  });

  /**
   * Rows the vendor holds NO metrics for still feed the "oldest stamp" calculation — DFS
   * stamps them anyway, and that stamp is exactly the claim this line makes: when the vendor
   * last looked. Skipping them could only make the batch read FRESHER than the vendor's own
   * oldest look, which is the wrong direction for an honesty line. Measured here rather than
   * merely asserted in a comment.
   */
  it("counts a NO-DATA row's timestamp toward the oldest, never flattering the batch by skipping it", () => {
    const text = renderVendorFreshness(
      [
        classicRow({ keyword: "answered", search_volume: 100, last_updated_time: daysBefore(2) }),
        classicRow({ keyword: "backlink checker", has_data: false, last_updated_time: daysBefore(120) }),
      ],
      NOW,
    );
    expect(text).toContain("120 days ago");
    expect(text).toMatch(/stale/);
    expect(text).not.toContain("2 days ago");
  });

  it("calls the data stale in a SENTENCE at the imported threshold, not a day before", () => {
    const fresh = renderVendorFreshness(
      [classicRow({ keyword: "k", last_updated_time: daysBefore(STALE_PULL_DAYS - 1) })],
      NOW,
    );
    expect(fresh).not.toMatch(/stale/);
    const stale = renderVendorFreshness(
      [classicRow({ keyword: "k", last_updated_time: daysBefore(STALE_PULL_DAYS) })],
      NOW,
    );
    expect(stale).toMatch(/stale — treat CPC and competition as indicative, not current/);
  });

  it("returns null when no keyword carried a timestamp — no line beats an invented date", () => {
    expect(renderVendorFreshness([classicRow({ keyword: "k" })], NOW)).toBeNull();
    expect(renderVendorFreshness([classicRow({ keyword: "k", last_updated_time: "junk" })], NOW)).toBeNull();
  });

  it("is appended UNDER the table by the formatter, never inside a keyword row", () => {
    const text = formatKeywordOverview(
      [
        classicRow({
          keyword: "seo software",
          search_volume: 100,
          cpc: 27.66,
          last_updated_time: "2026-08-10 08:12:33 +00:00",
        }),
      ],
      asked("seo software"),
      NOW,
    );
    const lines = text.split("\n");
    expect(lines[1]).toBe("• seo software — volume 100, CPC $27.66, competition n/a");
    expect(lines[2]).toBe(
      "CPC and competition were last refreshed by DataForSEO on 2026-08-10 (7 days ago).",
    );
  });
});

describe("research_keywords metadata", () => {
  const tool = makeResearchKeywordsTool();

  it("advertises its name, the 25-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("research_keywords");
    expect(tool.description).toContain("Costs 25 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    // keywords is required; the defaulted fields are advertised OPTIONAL (io:"input").
    expect(schema.required).toEqual(["keywords"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "keywords",
      "language_code",
      "location_code",
    ]);
  });

  it("names the metrics the Labs endpoint added, so the surface matches what it returns", () => {
    // The description is what an MCP client shows BEFORE 25 credits are spent; a tool that
    // returns difficulty/intent/trend while advertising only volume/CPC/competition undersells
    // itself, and the reverse would be a lie.
    expect(tool.description).toMatch(/keyword difficulty/i);
    expect(tool.description).toMatch(/search intent/i);
    expect(tool.description).toMatch(/trend/i);
  });

  it("rejects invalid input before any handler work", async () => {
    const result = await tool.run(CTX, { keywords: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });
});

describe("research_keywords live-disabled gate (no credit machinery)", () => {
  // Strip every SUPABASE var: if the tool tried to reserve, getServiceClient -> loadEnv
  // would throw the env error. A clean not-enabled result therefore proves the gate
  // short-circuits BEFORE withCredits (zero ledger rows, NEVER #2).
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

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeResearchKeywordsTool({ port: disabledPort() });
    const result = await tool.run(CTX, { keywords: ["seo software"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    // The error is the honesty gate, NOT a leaked env/DB failure.
    expect(result.content[0]?.text).not.toMatch(/environment|supabase/i);
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    // Complement of the gate proof: with a serving port, run() must reach withCredits ->
    // reserve -> getServiceClient -> loadEnv, which throws because SUPABASE_* are stripped.
    const tool = makeResearchKeywordsTool({ port: createMockResearchPort(fixtureResponse) });
    await expect(tool.run(CTX, { keywords: ["seo software"] })).rejects.toThrow(
      /environment configuration/i,
    );
  });
});

// =============================================================================================
// S1 (follow-up) — the flagship keyword tool's difficulty, through the real parser and renderer.
//
// This tool carries the same promise wording as discover_keywords, and ranked_keywords' source
// names it as the tool whose difficulty phrasing must not drift (dfs/ranked-keywords.ts:291).
// The PARSE half is already pinned — mutating dfs/client.ts:255 goes red. The RENDER half was
// not: turning `row.keyword_difficulty !== null` into a TRUTHINESS test at
// tools/research-keywords.ts:172 left the whole suite green, silently swallowing a vendor-reported
// difficulty of 0 into the same silence an absent field gets.
//
// So the pair below is asymmetric on purpose. The absent half is the claim the product makes; the
// PRESENT-AS-0 half is the one that catches the truthiness bug, because absent and zero are only
// distinguishable if the zero survives.
// =============================================================================================

/** A keyword-overview envelope carrying one item verbatim, as DataForSEO returns it. */
function overviewEnvelope(item: Record<string, unknown>): unknown {
  return { status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [item] }] }] };
}

/** The measured item shape; `keyword_properties` is supplied by each spec. */
function overviewItem(keywordProperties: Record<string, unknown>): Record<string, unknown> {
  return {
    keyword: "diş beyazlatma",
    keyword_info: {
      se_type: "google",
      last_updated_time: "2026-08-01 00:00:00 +00:00",
      competition_level: "LOW",
      cpc: 0.35,
      search_volume: 2400,
    },
    keyword_properties: keywordProperties,
  };
}

/** Parse an overview body through the real parser and render it, exactly as the handler does. */
function renderedOverview(keywordProperties: Record<string, unknown>): string {
  return formatKeywordOverview(
    parseKeywordOverviewResponse(overviewEnvelope(overviewItem(keywordProperties))),
    { keywords: ["diş beyazlatma"], language_code: "tr", location_code: 2792 },
    NOW,
  );
}

describe("S1 — a difficulty absent from the vendor body never becomes a 0", () => {
  it("omits difficulty when keyword_properties carries no keyword_difficulty key", () => {
    // The key is ABSENT, not null — absence is the case under test.
    const text = renderedOverview({ se_type: "google", detected_language: "tr" });
    expect(text).not.toMatch(/difficulty/i);
    // …while the row itself is intact: the omission is one field, not a degraded line.
    expect(text).toContain("• diş beyazlatma — volume 2,400, CPC $0.35, competition LOW");
  });

  it("prints difficulty 0/100 when DataForSEO reports the difficulty AS 0", () => {
    const text = renderedOverview({ se_type: "google", detected_language: "tr", keyword_difficulty: 0 });
    expect(text).toContain("difficulty 0/100");
  });
});

// =============================================================================================
// S12 — THE TURKISH LOOKUP, through the real parser and the real formatter.
//
// The production symptom (2026-08-25, 25 credits): `diş beyazlatma` in the Turkish market came
// back "no data returned for this keyword", while discover_keywords answered the same market with
// real figures. The premise handed to this fix — "research_keywords is on the retired
// keywords_data/google_ads endpoint, move it to Labs" — was checked and is FALSE: the move landed
// 2026-08-17 and `main` POSTs to dataforseo_labs/google/keyword_overview/live. So these specs pin
// the two defects that ARE in the code, both of them below the endpoint:
//
//   1. the projection read "has data" from three GOOGLE-ADS-sourced fields only, so a Labs row
//      whose Ads half is empty and whose Labs half (difficulty, intent) is full was printed as
//      one "no data" sentence with everything the vendor DID send thrown away;
//   2. a keyword the vendor answered with a `keyword: null` item — or did not answer at all —
//      vanished from the reply with nothing anywhere saying so.
//
// Driven end to end: fixture -> parseKeywordOverviewResponse -> formatKeywordOverview. Nothing is
// asserted against a row object built downstream of the parser (signed lesson 12).
// =============================================================================================

/** Exactly what a caller asks about; the fixture's items answer these, in this order. */
const TR_KEYWORDS = ["diş beyazlatma fiyat", "implant fiyatları", "zirkonyum kaplama", "implant"];
const TR_INPUT = { keywords: TR_KEYWORDS, language_code: "tr", location_code: 2792 };

const renderTurkish = (): string =>
  formatKeywordOverview(parseKeywordOverviewResponse(trFixture), TR_INPUT, NOW);

describe("S12 — a Turkish keyword in the Turkish market comes back with NUMBERS", () => {
  it("prints volume, CPC and competition for the keyword the vendor priced", () => {
    expect(renderTurkish()).toContain("• diş beyazlatma fiyat — volume 12,100, CPC $0.84, competition MEDIUM");
  });

  it("prints the three Labs-only metrics the description promises: difficulty, intent, trend", () => {
    const text = renderTurkish();
    expect(text).toContain("difficulty 41/100");
    expect(text).toContain("intent commercial (also transactional)");
    expect(text).toContain("trend +22% MoM, +8% QoQ, -5% YoY");
  });

  /**
   * The row the narrow has_data verdict destroyed. Its Google-Ads half is empty — no volume, no
   * CPC, no competition band — but DataForSEO sent a difficulty AND an intent for it. Before the
   * widening this whole row rendered as "no data returned for this keyword"; the paid metrics were
   * parsed and then discarded one line later.
   */
  it("keeps the difficulty and intent of a row whose Google-Ads metrics are empty", () => {
    const text = renderTurkish();
    expect(text).toContain("• implant — volume n/a, CPC n/a, competition n/a, difficulty 38/100, intent informational");
    expect(text).not.toContain("• implant — no data");
  });

  /** …and a row with NOTHING on it anywhere is still the "no data" sentence, not an invented zero. */
  it("still says NO DATA for a row the vendor sent no metric of any kind for", () => {
    const text = renderTurkish();
    expect(text).toContain("• zirkonyum kaplama — no data returned for this keyword");
    expect(text).not.toContain("• zirkonyum kaplama — volume 0");
  });
});

describe("S12 — every keyword the caller asked about is accounted for", () => {
  /**
   * `implant fiyatları` is the keyword the vendor answered with a `keyword: null` item, which the
   * projection drops — the exact production shape: three keywords in, N−1 out, silence about the
   * one that went missing. It must come back as a SENTENCE, and one that says what we actually
   * know (no row arrived) rather than borrowing the "vendor holds nothing" claim.
   */
  it("names the keyword whose row never arrived instead of dropping it", () => {
    expect(renderTurkish()).toContain("• implant fiyatları — DataForSEO returned no row for this keyword");
  });

  it("leaves not one asked-for keyword out of the reply", () => {
    const text = renderTurkish();
    for (const keyword of TR_KEYWORDS) {
      expect(text).toContain(`• ${keyword} —`);
    }
  });

  it("counts the unanswered keywords — the empty row AND the absent one — in the header", () => {
    expect(renderTurkish()).toContain(
      "Search volume for 4 keywords (language tr, location 2792), 12,100 total monthly searches (2 keywords returned no data):",
    );
  });

  /** The whole reply, so the ORDER (vendor rows first, then the absent ones) is pinned too. */
  it("renders the whole table in one pinned shape", () => {
    expect(renderTurkish()).toBe(
      "Search volume for 4 keywords (language tr, location 2792), 12,100 total monthly searches (2 keywords returned no data):\n" +
        "• diş beyazlatma fiyat — volume 12,100, CPC $0.84, competition MEDIUM, difficulty 41/100, " +
        "intent commercial (also transactional), trend +22% MoM, +8% QoQ, -5% YoY\n" +
        "• zirkonyum kaplama — no data returned for this keyword\n" +
        "• implant — volume n/a, CPC n/a, competition n/a, difficulty 38/100, intent informational\n" +
        "• implant fiyatları — DataForSEO returned no row for this keyword\n" +
        "CPC and competition were last refreshed by DataForSEO on 2026-08-11 (6 days ago).",
    );
  });

  it("matches case- and whitespace-insensitively, the way DataForSEO echoes keywords", () => {
    // The vendor lowercases what it echoes, so a caller who typed capitals must not be told their
    // own keyword went missing.
    const rows = parseKeywordOverviewResponse(trFixture);
    expect(missingKeywords(rows, ["  Diş  Beyazlatma Fiyat  "])).toEqual([]);
    expect(missingKeywords(rows, ["ortodonti"])).toEqual(["ortodonti"]);
    // A blank was never a keyword, so it is not "missing" either.
    expect(missingKeywords(rows, ["   "])).toEqual([]);
  });

  /**
   * The Turkish dotted capital, measured rather than assumed: `"FİYAT".toLowerCase()` is `i` +
   * U+0307, NOT `"fiyat"` — the first draft of this spec failed on exactly that, in exactly the
   * market this whole fix is about. Left un-folded, the reconciliation would print "no row for
   * this keyword" NEXT TO the row that answers it: a false sentence invented by the cure.
   */
  it("folds the Turkish dotted capital \u0130, which toLowerCase alone does not", () => {
    expect("F\u0130YAT".toLowerCase()).not.toBe("fiyat"); // the vendor-independent fact underneath
    const rows = parseKeywordOverviewResponse(trFixture);
    expect(missingKeywords(rows, ["D\u0130\u015E BEYAZLATMA F\u0130YAT"])).toEqual([]);
  });

  /** …and folds nothing else: ş and s are different letters, and this market is why that matters. */
  it("does NOT fold \u015F into s, which would call an absent keyword answered", () => {
    const rows = parseKeywordOverviewResponse(trFixture);
    expect(missingKeywords(rows, ["dis beyazlatma fiyat"])).toEqual(["dis beyazlatma fiyat"]);
  });
});

describe("S12 — a lookup that measured nothing is not an answer", () => {
  /** The measured empty shape: items carrying only `keyword` and `location_code`. */
  const emptyRows = parseKeywordOverviewResponse(trEmptyFixture);

  it("classifies a response whose every item is empty as unanswered", () => {
    expect(emptyRows).toHaveLength(2);
    expect(emptyRows.every((row) => row.has_data)).toBe(false);
    expect(isUnansweredLookup(emptyRows)).toBe(true);
  });

  it("classifies no rows at all as unanswered", () => {
    expect(isUnansweredLookup([])).toBe(true);
  });

  it("does NOT call the Turkish lookup unanswered — one priced row is an answer", () => {
    expect(isUnansweredLookup(parseKeywordOverviewResponse(trFixture))).toBe(false);
  });

  /** A row carrying only a Labs metric is an answer too — nothing about it is Ads-shaped. */
  it("counts a row with only a difficulty as answered", () => {
    const rows = parseKeywordOverviewResponse({
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [{ items: [{ keyword: "implant", keyword_properties: { keyword_difficulty: 38 } }] }],
        },
      ],
    });
    expect(isUnansweredLookup(rows)).toBe(false);
  });
});
