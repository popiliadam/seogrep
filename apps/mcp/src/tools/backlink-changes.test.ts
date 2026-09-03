import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import {
  createMockBacklinkChangesPort,
  disabledBacklinkChangesPort,
  MAX_BACKLINK_CHANGES_PERIODS,
  type BacklinkChangePoint,
  type BacklinkChangesResult,
  type BacklinkProfilePoint,
} from "../dfs/backlink-changes.ts";
import {
  PARTIAL_BUCKET_MARKER,
  PARTIAL_BUCKET_NOTE,
  SERIES_DO_NOT_RECONCILE_NOTE,
  formatBacklinkChanges,
  makeBacklinkChangesTool,
} from "./backlink-changes.ts";
import { projectNotFoundMessage, type LoadProjectFn, type ProjectRef } from "./project-target.ts";
import newLostFixture from "../dfs/fixtures/backlinks-timeseries-new-lost-summary.json";
import summaryFixture from "../dfs/fixtures/backlinks-timeseries-summary.json";

/**
 * Fast-lane (DB-less) proofs for backlink_changes. The credit LEDGER behaviour (mock -> reserve
 * + commit at 35; disabled / DFS-error -> no charge) is proven against the real stack in
 * backlink-changes.db.test.ts. Here we prove: the pure formatter (whose every label must carry
 * DataForSEO's DOCUMENTED meaning and nothing stronger), the tool metadata, and — critically —
 * that every free pre-reserve gate returns without touching credits.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT: ProjectRef = { id: PROJECT_ID, domain: "example.com", archivedAt: null };

const loadProject: LoadProjectFn = async (userId, projectId) =>
  userId === CTX.userId && projectId === PROJECT_ID ? PROJECT : null;

const CHANGE: BacklinkChangePoint = {
  date: "2021-12-31 00:00:00 +00:00",
  new_backlinks: 1248,
  lost_backlinks: 173,
  new_referring_domains: 121,
  lost_referring_domains: 31,
};

const PROFILE: BacklinkProfilePoint = {
  date: "2021-12-31 00:00:00 +00:00",
  rank: 293,
  backlinks: 1334,
  referring_domains: 422,
};

function history(
  changes: readonly BacklinkChangePoint[],
  profile: readonly BacklinkProfilePoint[],
  window: { from: string | null; to: string | null } = { from: "2021-12-01", to: "2022-02-01" },
): BacklinkChangesResult {
  return {
    target: "example.com",
    group_range: "month",
    date_from: window.from,
    date_to: window.to,
    changes,
    profile,
  };
}

describe("formatBacklinkChanges", () => {
  it("renders a header naming the site, the grouping and the vendor's window", () => {
    const text = formatBacklinkChanges(history([CHANGE], [PROFILE]));
    expect(text).toContain('Backlink history for "example.com"');
    expect(text).toContain("month buckets from 2021-12-01 to 2022-02-01");
    expect(text).toContain("as DataForSEO grouped them");
  });

  /**
   * EACH SERIES OWNS ITS OWN BUCKET COUNT, and this spec varies the axis that proves it: the two
   * endpoints are answered independently and can return different numbers of buckets. A single
   * count in the heading would be a claim about both series taken from one of them.
   *
   * Written because a mutation showed the earlier heading count was unpinned: swapping the max of
   * the two lengths for just the new/lost length broke nothing, since no spec had ever handed the
   * formatter two series of different lengths.
   */
  it("gives each series its OWN bucket count when the two series disagree in length", () => {
    const text = formatBacklinkChanges(
      history(
        [CHANGE],
        [PROFILE, { ...PROFILE, date: "2022-01-31 00:00:00 +00:00" }, { ...PROFILE, date: "2022-02-28 00:00:00 +00:00" }],
      ),
    );
    expect(text).toContain("New and lost — 1 month bucket.");
    expect(text).toContain("Profile at each bucket — 3 month buckets:");
    // ...and the heading itself claims no count for either of them.
    expect(text).toMatch(/Backlink history for "example\.com" — month buckets from/);
  });

  it("prints both series with their own bullets and groups digits", () => {
    const text = formatBacklinkChanges(history([CHANGE], [PROFILE]));
    expect(text).toContain(
      "• 2021-12-31 — 1,248 new / 173 lost backlinks · 121 new / 31 lost referring domains",
    );
    expect(text).toContain("• 2021-12-31 — 1,334 backlinks · 422 referring domains · rank 293 of 1,000");
  });

  /**
   * THE MEASURED DEFECT (2026-08-25): a default lookup printed "00:00:00 +00:00" TWENTY-SIX times
   * in one answer. The clock is identical on every row of both series — it is the vendor's storage
   * convention, not a measurement — and it buried the dates the reader came for.
   *
   * Both series are driven through the real formatter, and the assertion is on ABSENCE across the
   * whole answer rather than on one bullet: a rule applied to one series and forgotten on the
   * other is exactly the shape a per-bullet spec would let through.
   */
  it("labels month buckets with their date, with no zero clock anywhere in the answer", () => {
    const text = formatBacklinkChanges(
      history(
        [CHANGE, { ...CHANGE, date: "2022-01-31 00:00:00 +00:00" }],
        [PROFILE, { ...PROFILE, date: "2022-01-31 00:00:00 +00:00" }],
      ),
    );
    expect(text).not.toMatch(/00:00:00/);
    expect(text).not.toMatch(/\+00:00/);
    expect(text).toMatch(/• 2021-12-31 — /);
    expect(text).toMatch(/• 2022-01-31 — /);
  });

  /**
   * ...AND ONLY A ZERO CLOCK IS DROPPED. A bucket carrying a real time of day is carrying
   * information; the tool keeps the vendor's label verbatim rather than deciding for the reader
   * that the time did not matter.
   */
  it("keeps a bucket label that carries a real time of day", () => {
    const text = formatBacklinkChanges(
      history([{ ...CHANGE, date: "2021-12-31 13:05:00 +00:00" }], []),
    );
    expect(text).toContain("• 2021-12-31 13:05:00 +00:00 — ");
  });

  /**
   * The definition is DataForSEO's own, carried verbatim. A friendlier paraphrase ("links you
   * gained this month") would be a different claim: the vendor counts against the window's
   * opening date, not against the bucket.
   */
  it("states the vendor's OWN definition of new and lost, not a friendlier one", () => {
    const text = formatBacklinkChanges(history([CHANGE], [PROFILE]));
    expect(text).toMatch(/appeared in its index after the window opened/i);
    expect(text).toMatch(/present before the window and was not found after it/i);
  });

  /**
   * The whole reason this tool prints two series and no third: DataForSEO's own examples for the
   * two endpoints disagree. The output must say so, and must never publish a derived figure.
   */
  it("warns that the two series are not each other's arithmetic, and derives nothing", () => {
    const text = formatBacklinkChanges(history([CHANGE], [PROFILE]));
    expect(text).toContain(SERIES_DO_NOT_RECONCILE_NOTE);
    expect(text).not.toMatch(/net (change|new|gain)/i);
    expect(text).not.toMatch(/churn/i);
    expect(text).not.toMatch(/growth rate|% change/i);
  });

  it("omits the reconciliation warning when only ONE series came back", () => {
    expect(formatBacklinkChanges(history([CHANGE], []))).not.toContain(SERIES_DO_NOT_RECONCILE_NOTE);
    expect(formatBacklinkChanges(history([], [PROFILE]))).not.toContain(SERIES_DO_NOT_RECONCILE_NOTE);
  });

  /**
   * The honesty line signed lesson 12 exists for: an ABSENT vendor figure must not be rendered as
   * a zero. On a backlink report a fabricated 0 reads as "nothing was lost", which is news.
   */
  it("prints n/a for a metric DataForSEO had no value for, never a zero", () => {
    const text = formatBacklinkChanges(
      history(
        [
          {
            date: "2022-01-31 00:00:00 +00:00",
            new_backlinks: null,
            lost_backlinks: null,
            new_referring_domains: null,
            lost_referring_domains: null,
          },
        ],
        [{ date: "2022-01-31 00:00:00 +00:00", rank: null, backlinks: null, referring_domains: null }],
      ),
    );
    expect(text).toContain("n/a new / n/a lost backlinks · n/a new / n/a lost referring domains");
    expect(text).toContain("n/a backlinks · n/a referring domains · rank n/a of 1,000");
    expect(text).not.toMatch(/— 0 new/);
  });

  /** A vendor ZERO is data the vendor sent, and is printed as 0 rather than hidden. */
  it("prints a vendor zero as zero — it is a real answer", () => {
    const text = formatBacklinkChanges(
      history([{ ...CHANGE, new_backlinks: 0, lost_backlinks: 0 }], [PROFILE]),
    );
    expect(text).toContain("0 new / 0 lost backlinks");
  });

  it("admits it when DataForSEO named no window, instead of inventing dates", () => {
    const text = formatBacklinkChanges(history([CHANGE], [PROFILE], { from: null, to: null }));
    expect(text).toContain("over the window DataForSEO answered for (it did not name the dates)");
    expect(text).not.toMatch(/from null/);
  });

  it("says plainly when there is no history at all, instead of printing empty sections", () => {
    const text = formatBacklinkChanges(history([], []));
    expect(text).toContain("No backlink history found");
    expect(text).not.toContain("•");
  });

  it("names the resolved PROJECT in the heading when the target came from one", () => {
    expect(formatBacklinkChanges(history([CHANGE], [PROFILE]), PROJECT)).toContain(
      'Backlink history for your project "example.com"',
    );
  });

  it("does NOT invent a project for a bare-target lookup", () => {
    expect(formatBacklinkChanges(history([CHANGE], [PROFILE]))).not.toContain("your project");
  });
});

// =============================================================================================
// B-4 (record backlink_changes.md, 2026-09-04) — THE THIRD MEANING OF A PRINTED ZERO.
//
// MEASURED in BOTH live calls of that round, run on 2026-09-03: the last bucket came back
// labelled 2026-09-30 (monthly) and 2026-09-06 (weekly) — dates in the FUTURE — carrying
// `0 new / 0 lost` and a profile line repeating the previous bucket's figures verbatim.
//
// The tool already separates the vendor's own 0 ("nothing happened") from a missing field
// ("the vendor declined to say", printed n/a). The third case — "this period has not ended
// yet" — had no wording anywhere: `grep -rniI "incomplete|partial bucket|current bucket|in
// progress"` over the tool, the port and the mdx returned 0.
//
// NOTHING IS DROPPED (NEVER #7): the vendor's bucket, its label and its figures all still
// print. The only additions are a marker on the affected line and one sentence saying what it
// means. The test injects `today` rather than reading the clock, so the assertion is about the
// rule and not about the day the suite runs.
// =============================================================================================
describe("formatBacklinkChanges — the unfinished last bucket (B-4)", () => {
  const TODAY = new Date("2026-09-03T22:00:00.000Z");
  const finished: BacklinkChangePoint = { ...CHANGE, date: "2026-08-31 00:00:00 +00:00" };
  const unfinished: BacklinkChangePoint = {
    ...CHANGE,
    date: "2026-09-30 00:00:00 +00:00",
    new_backlinks: 0,
    lost_backlinks: 0,
    new_referring_domains: 0,
    lost_referring_domains: 0,
  };
  const finishedProfile: BacklinkProfilePoint = { ...PROFILE, date: "2026-08-31 00:00:00 +00:00" };
  const unfinishedProfile: BacklinkProfilePoint = {
    ...PROFILE,
    date: "2026-09-30 00:00:00 +00:00",
  };

  it("marks a bucket dated after today as partial, in BOTH series", () => {
    const text = formatBacklinkChanges(
      history([finished, unfinished], [finishedProfile, unfinishedProfile]),
      null,
      TODAY,
    );
    const lines = text.split("\n").filter((line) => line.startsWith("•"));
    const marked = lines.filter((line) => line.includes(PARTIAL_BUCKET_MARKER));
    expect(marked).toHaveLength(2);
    expect(marked.every((line) => line.includes("2026-09-30"))).toBe(true);
  });

  it("keeps the vendor's own label and figures on the marked line — nothing is dropped", () => {
    const text = formatBacklinkChanges(history([finished, unfinished], []), null, TODAY);
    expect(text).toContain("2026-09-30");
    expect(text).toContain("0 new / 0 lost backlinks");
    // The pre-fix output was exactly this line WITHOUT the marker; the count is still 2 buckets.
    expect(text).toContain("2 month buckets");
  });

  it("explains the marker once, and only when a bucket actually carries it", () => {
    const withPartial = formatBacklinkChanges(
      history([finished, unfinished], [finishedProfile, unfinishedProfile]),
      null,
      TODAY,
    );
    expect(withPartial.split(PARTIAL_BUCKET_NOTE)).toHaveLength(2);
    const withoutPartial = formatBacklinkChanges(
      history([finished], [finishedProfile]),
      null,
      TODAY,
    );
    expect(withoutPartial).not.toContain(PARTIAL_BUCKET_NOTE);
    expect(withoutPartial).not.toContain(PARTIAL_BUCKET_MARKER);
  });

  /**
   * THE BOUNDARY, and the first pass had it backwards. It pinned "a bucket dated today says
   * nothing", reasoning that such a bucket is only unfinished until midnight. That reads the
   * label as a point in time; it is not. DataForSEO labels a bucket with the END of the period
   * it covers, so a bucket labelled TODAY covers a period that ends today — and at the moment
   * the call is answered, today is not over. The comparison is `>=`, and these are its specs.
   */
  it("marks a bucket dated TODAY — its period ends today, so it has not ended yet", () => {
    const todayBucket: BacklinkChangePoint = { ...CHANGE, date: "2026-09-03 00:00:00 +00:00" };
    const text = formatBacklinkChanges(history([todayBucket], []), null, TODAY);
    expect(text).toContain(PARTIAL_BUCKET_MARKER);
    expect(text).toContain(PARTIAL_BUCKET_NOTE);
  });

  it("says nothing about a bucket whose period closed BEFORE today", () => {
    const text = formatBacklinkChanges(history([finished], [finishedProfile]), null, TODAY);
    expect(text).not.toContain(PARTIAL_BUCKET_MARKER);
  });

  /**
   * `day` grouping is where this stops being an edge case: the last bucket of a daily series is
   * labelled today on EVERY call, so under the old `>` boundary the freshest line in the series
   * — the one a reader looks at first — was the one most likely to be misread as "0 today".
   */
  it("marks the last bucket of a DAILY series, which is always labelled today", () => {
    const yesterday: BacklinkChangePoint = { ...CHANGE, date: "2026-09-02 00:00:00 +00:00" };
    const today: BacklinkChangePoint = {
      ...CHANGE,
      date: "2026-09-03 00:00:00 +00:00",
      new_backlinks: 0,
      lost_backlinks: 0,
    };
    const text = formatBacklinkChanges(
      { ...history([yesterday, today], []), group_range: "day" },
      null,
      TODAY,
    );
    const lines = text.split("\n").filter((line) => line.startsWith("•"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain(PARTIAL_BUCKET_MARKER);
    expect(lines[1]).toContain(PARTIAL_BUCKET_MARKER);
  });

  it("leaves a bucket alone when the vendor's label is not a date it can read", () => {
    const odd: BacklinkChangePoint = { ...CHANGE, date: "sometime in September" };
    const text = formatBacklinkChanges(history([odd], []), null, TODAY);
    expect(text).toContain("sometime in September");
    expect(text).not.toContain(PARTIAL_BUCKET_MARKER);
  });
});

describe("backlink_changes tool metadata", () => {
  const tool = makeBacklinkChangesTool();

  it("advertises its name, the 35-credit cost, and a snake_case input schema", () => {
    expect(tool.name).toBe("backlink_changes");
    expect(tool.description).toContain("Costs 35 credits.");
    const schema = tool.inputJsonSchema as {
      required?: string[];
      properties: Record<
        string,
        { maximum?: number; minimum?: number; default?: unknown; format?: string; enum?: string[] }
      >;
    };
    expect(schema.required ?? []).toEqual([]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "group_range",
      "periods",
      "project_id",
      "target",
    ]);
    expect(schema.properties.project_id?.format).toBe("uuid");
    expect(schema.properties.group_range?.enum).toEqual(["day", "week", "month", "year"]);
    expect(schema.properties.group_range?.default).toBe("month");
  });

  /**
   * The window cap is the PRICE CONTROL: DataForSEO bills per returned row and the window is what
   * decides the row count, so a larger cap is a larger bill against a signed credit price
   * (NEVER #6). Pinned at the surface as well as in the port.
   */
  it("caps the window at the schema level, and defaults well below the cap", () => {
    const schema = tool.inputJsonSchema as {
      properties: Record<string, { default?: number; maximum?: number; minimum?: number }>;
    };
    expect(schema.properties.periods?.minimum).toBe(1);
    expect(schema.properties.periods?.maximum).toBe(MAX_BACKLINK_CHANGES_PERIODS);
    expect(schema.properties.periods?.default).toBe(12);
    expect(schema.properties.periods?.default).toBeLessThan(schema.properties.periods?.maximum ?? 0);
  });

  it("says it needs a paid balance and promises the free refusal", () => {
    expect(tool.description).toMatch(/paid credit balance/i);
    expect(tool.description).toMatch(/charges nothing/i);
  });

  it("rejects a window past the cap before any handler work", async () => {
    const result = await tool.run(CTX, { target: "example.com", periods: 5000 });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });

  it("rejects a group_range DataForSEO does not document", async () => {
    const result = await tool.run(CTX, { target: "example.com", group_range: "quarter" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
  });
});

describe("backlink_changes free pre-reserve gates (no credit machinery)", () => {
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

  const serving = () =>
    makeBacklinkChangesTool({
      port: createMockBacklinkChangesPort(newLostFixture, summaryFixture),
      loadProject,
    });

  it("rejects a non-public target without reaching the ledger", async () => {
    const result = await serving().run(CTX, { target: "not a domain" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a valid domain/i);
  });

  it("rejects a reserved/internal target exactly as every other domain tool does", async () => {
    const result = await serving().run(CTX, { target: "intranet.local" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not a public domain/i);
  });

  it("rejects a call naming NEITHER project_id nor target, without reaching the ledger", async () => {
    const result = await serving().run(CTX, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Nothing to look up/i);
  });

  it("rejects a call naming BOTH, without reaching the ledger", async () => {
    const result = await serving().run(CTX, { target: "example.com", project_id: PROJECT_ID });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not both/i);
  });

  it("answers another tenant's project id exactly as it answers an unknown uuid — free", async () => {
    const theirs = await serving().run(CTX, { project_id: OTHER_PROJECT_ID });
    expect(theirs.isError).toBe(true);
    expect(theirs.content[0]?.text).toBe(projectNotFoundMessage(OTHER_PROJECT_ID));
  });

  it("returns a clear English 'not enabled' error and never reaches the ledger", async () => {
    const tool = makeBacklinkChangesTool({ port: disabledBacklinkChangesPort(), loadProject });
    const result = await tool.run(CTX, { target: "example.com" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not yet enabled/i);
    expect(result.content[0]?.text).toMatch(/not charged/i);
    // ...and it never leaks the fixture it could have served instead (NEVER #7).
    expect(result.content[0]?.text).not.toContain("1,334");
    expect(result.content[0]?.text).not.toContain("2021-12-31");
  });

  it("the ENABLED path DOES enter the credit guard (reaches the DB, which is absent here)", async () => {
    await expect(serving().run(CTX, { target: "example.com" })).rejects.toThrow(/SUPABASE/i);
  });

  it("a RESOLVED project_id also reaches the credit guard — the gates are not a dead end", async () => {
    await expect(serving().run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(/SUPABASE/i);
  });
});

