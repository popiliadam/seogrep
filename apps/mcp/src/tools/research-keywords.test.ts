import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import { createMockResearchPort, disabledPort, type KeywordOverviewRow } from "../dfs/client.ts";
import { STALE_PULL_DAYS } from "../gsc-data/load.ts";
import {
  formatKeywordOverview,
  makeResearchKeywordsTool,
  parseDfsTimestamp,
  renderVendorFreshness,
} from "./research-keywords.ts";
import fixtureResponse from "../dfs/fixtures/keyword-overview.json";

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

const INPUT = { keywords: ["a", "b"], language_code: "en", location_code: 2840 };
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
});

describe("formatKeywordOverview — no data is NOT zero volume", () => {
  const rows = [
    classicRow({ keyword: "seo software", search_volume: 22200, cpc: 9.87, competition_level: "HIGH" }),
    classicRow({ keyword: "nobody searches this", search_volume: 0, cpc: 0, competition_level: "LOW" }),
    classicRow({ keyword: "backlink checker", has_data: false }),
  ];

  it("says a no-data keyword returned NO DATA, and never prints it as volume 0", () => {
    const text = formatKeywordOverview(rows, INPUT, NOW);
    expect(text).toContain("• backlink checker — no data returned for this keyword");
    expect(text).not.toContain("• backlink checker — volume 0");
    expect(text).not.toContain("• backlink checker — volume n/a");
  });

  it("still prints a genuine ZERO volume as a number, because that is a real measurement", () => {
    expect(formatKeywordOverview(rows, INPUT, NOW)).toContain(
      "• nobody searches this — volume 0, CPC $0.00, competition LOW",
    );
  });

  it("counts the no-data keywords out loud in the header instead of silently averaging them in", () => {
    const text = formatKeywordOverview(rows, INPUT, NOW);
    expect(text).toContain("22,200 total monthly searches (1 keyword returned no data):");
    const many = formatKeywordOverview(
      [...rows, classicRow({ keyword: "another unknown", has_data: false })],
      INPUT,
      NOW,
    );
    expect(many).toContain("(2 keywords returned no data)");
  });

  it("says nothing about missing data when every keyword was answered", () => {
    const text = formatKeywordOverview([rows[0] as KeywordOverviewRow], INPUT, NOW);
    expect(text).not.toMatch(/returned no data/);
  });
});

describe("formatKeywordOverview — the three metrics the Labs endpoint added", () => {
  it("prints keyword difficulty on a 0–100 scale", () => {
    const text = formatKeywordOverview(
      [classicRow({ keyword: "seo software", search_volume: 100, keyword_difficulty: 61 })],
      INPUT,
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
      INPUT,
      NOW,
    );
    expect(withForeign).toContain("intent commercial (also informational, transactional)");

    const soleIntent = formatKeywordOverview(
      [classicRow({ keyword: "seo software", search_volume: 100, main_intent: "navigational" })],
      INPUT,
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
      INPUT,
      NOW,
    );
    expect(text).toContain("trend +12% MoM, -45% YoY");
    expect(text).not.toContain("QoQ");
  });

  it("omits each added metric entirely when the vendor sent none of it", () => {
    const text = formatKeywordOverview(
      [classicRow({ keyword: "seo software", search_volume: 100, cpc: 1, competition_level: "LOW" })],
      INPUT,
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
      INPUT,
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
