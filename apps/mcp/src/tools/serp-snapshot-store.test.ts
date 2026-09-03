import { describe, expect, it, vi } from "vitest";

/**
 * THE WIRING between serp_snapshot and the measurement store (migration 0030), in the fast lane.
 *
 * `../credits/guard.ts` is replaced with a PASS-THROUGH, and that substitution is the reason this
 * file exists separately instead of living in `serp-snapshot.test.ts`. The tool is
 * charge:"handler" AND it is on the paid-balance gate, so its paid body runs inside a withCredits
 * whose FIRST act is a Supabase read — which is exactly what makes the sibling file's assertions
 * meaningful: every refusal that returns an errorResult there provably never reached a reserve.
 * Mocking the guard inside that file would destroy that proof.
 *
 * WHAT THIS LANE CAN AND CANNOT SHOW, said out loud because a double kinder than the runtime is how
 * a missing constraint becomes a green test (signed lesson 12). It CAN show what the handler hands
 * the writer, that the write happens BEFORE the reply is returned, that it is not guarded, and that
 * a writer error escapes. It CANNOT show what withCredits then does with that error, nor that the
 * DATABASE would really have rejected the row — the release, the absence of `spend_commit`, and a
 * REAL CHECK rejection out of a REAL insert are serp-snapshot.db.test.ts's, which drives a row the
 * migration refuses rather than a simulated throw.
 */
vi.mock("../credits/guard.ts", () => ({
  withCredits: async <T>(_ctx: unknown, _meta: unknown, fn: () => Promise<T>): Promise<T> => fn(),
  isReserveCommitFailed: () => false,
}));

import type { AuthContext } from "../auth.ts";
import {
  createMockSerpSnapshotPort,
  disabledSerpSnapshotPort,
  type SerpKeywordRow,
} from "../dfs/serp.ts";
import fixture from "../dfs/fixtures/serp-organic-live-advanced.json";
import { makeSerpSnapshotTool } from "./serp-snapshot.ts";
import { makeKeywordPositionsTool } from "./keyword-positions.ts";
import {
  measurementRow,
  type SerpMeasurementTarget,
} from "./serp-snapshot-store.ts";
import type {
  CountMeasurementsFn,
  LoadMeasurementsFn,
  MeasurementFilter,
  MeasurementStatus,
  StoredMeasurement,
} from "./keyword-positions-store.ts";
import { readStoredReport } from "./keyword-positions-store.ts";
import type { TrackedDevice } from "./serp-devices.ts";

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const CLOCK = () => "2026-08-24T09:00:00.000Z";

describe("the write is fail-closed and unguarded", () => {
  const mockPort = () => createMockSerpSnapshotPort(fixture, CLOCK);

  /**
   * THE WRITE HAPPENS BEFORE THE REPLY IS RETURNED. Asserted by making the writer the thing that
   * decides what the caller sees: if the write were moved after the return — or fired without an
   * `await` — the handler would resolve with the snapshot and the rejection would surface as an
   * unhandled rejection instead.
   */
  it("returns the snapshot only AFTER the measurements are recorded", async () => {
    const order: string[] = [];
    const tool = makeSerpSnapshotTool({
      port: mockPort(),
      writeMeasurements: async () => {
        order.push("write");
      },
    });
    const result = await tool.run(CTX, { target: "example.com", keywords: ["seo software"] });
    order.push("reply");
    expect(order).toEqual(["write", "reply"]);
    expect(result.isError).toBeUndefined();
  });

  /**
   * THE WRITE IS NOT GUARDED. A writer that rejects must take the handler down with it: withCredits
   * commits a handler that RETURNS and releases one that THROWS, so a swallowed write error is the
   * one shape that charges for a snapshot `keyword_positions` will forever say never happened.
   * (What the ledger then does about it is measured on the real stack — serp-snapshot.db.test.ts.)
   */
  it("lets a failing write escape the handler rather than swallowing it", async () => {
    const tool = makeSerpSnapshotTool({
      port: mockPort(),
      writeMeasurements: async () => {
        throw new Error(
          "serp_snapshot: keyword_position_measurements write failed (simulated 23514)",
        );
      },
    });
    await expect(
      tool.run(CTX, { target: "example.com", keywords: ["seo software"] }),
    ).rejects.toThrow(/keyword_position_measurements write failed/);
  });

  /** ONE write for the WHOLE snapshot: all the rows or none of them (see the store's header). */
  it("writes every keyword's measurement in ONE call, with the tenant and the project", async () => {
    const calls: { userId: string; projectId: string | null; rows: number }[] = [];
    const tool = makeSerpSnapshotTool({
      port: mockPort(),
      writeMeasurements: async (target, rows) => {
        calls.push({ userId: target.userId, projectId: target.projectId, rows: rows.length });
      },
    });
    await tool.run(CTX, { target: "example.com", keywords: ["a", "b", "c"] });
    expect(calls).toEqual([{ userId: "user-1", projectId: null, rows: 3 }]);
  });

  /** A refusal before the reserve records nothing at all — there was no measurement to record. */
  it("records nothing when the live path is unavailable", async () => {
    const calls: number[] = [];
    const tool = makeSerpSnapshotTool({
      port: disabledSerpSnapshotPort(),
      writeMeasurements: async (_target, rows) => {
        calls.push(rows.length);
      },
    });
    const result = await tool.run(CTX, { target: "example.com", keywords: ["seo software"] });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});

// =============================================================================================
// THE CHAIN, END TO END, OFFLINE: serp_snapshot -> keyword_position_measurements -> keyword_positions
//
// Production had never once produced a real position: the only three rows the table ever held were
// `status='not_measured'`, so nothing had ever proven that a MEASURED row survives the round trip
// and comes back out under the SAME locale and device it was measured on. That is what this block
// measures — with the mock port for the vendor half (NEVER #5) and an in-memory table for the
// storage half.
//
// WHAT THIS LANE CANNOT SHOW, stated because a double kinder than the runtime is how a missing
// constraint becomes a green test (signed lesson 12): the fake table below is NOT PostgreSQL. It
// does not enforce migration 0030's CHECKs, its RLS, or its column types — serp-snapshot.db.test.ts
// and keyword-positions.db.test.ts own those. What it DOES enforce honestly is the reader's own
// narrowing: `user_id`, `target_domain`, keyword, location, language and device are all applied,
// and the "wrong device" case below fails if any of them is dropped.
// =============================================================================================

/**
 * The domain the snapshot is taken FOR, and the fixture rewritten so that domain is the one holding
 * the fixture's ranking organic result (rank_group 3, rank_absolute 4, of 2 organic items).
 *
 * The rewrite exists because the shipped fixture ranks `example-fixture.test`, and `.test` is a
 * RESERVED TLD that `setup_project`'s domain gate refuses — so the tool never reaches the port with
 * it and no row is ever written. Only the DOMAIN STRING is substituted; every rank, type, count and
 * timestamp the vendor sent is left exactly as it is, because those are what the assertions read.
 */
const RANKED_TARGET = "example.com";
const rankedFixture: unknown = JSON.parse(
  JSON.stringify(fixture).replaceAll("example-fixture.test", RANKED_TARGET),
);

type StoredRow = ReturnType<typeof measurementRow>;

/** An in-memory `keyword_position_measurements`, narrowed exactly the way the real reader narrows. */
function memoryTable() {
  const rows: StoredRow[] = [];

  const matches = (row: StoredRow, userId: string, filter: MeasurementFilter): boolean => {
    if (row.user_id !== userId) return false;
    if (row.target_domain !== filter.targetDomain) return false;
    if (filter.keyword !== undefined && row.keyword !== filter.keyword) return false;
    if (filter.locationName !== undefined && row.location_name !== filter.locationName) {
      return false;
    }
    if (filter.languageCode !== undefined && row.language_code !== filter.languageCode) {
      return false;
    }
    if (filter.device !== undefined && row.device !== filter.device) return false;
    return true;
  };

  const project = (row: StoredRow): StoredMeasurement => ({
    keyword: row.keyword,
    targetDomain: row.target_domain,
    locationName: row.location_name,
    languageCode: row.language_code,
    device: row.device as TrackedDevice,
    searchEngine: row.search_engine,
    depthRequested: row.depth_requested,
    domainMatchRule: row.domain_match_rule,
    status: row.status as MeasurementStatus,
    bestRankGroup: row.best_rank_group ?? null,
    bestRankAbsolute: row.best_rank_absolute ?? null,
    organicItemsExamined: row.organic_items_examined ?? null,
    notMeasuredReason: row.not_measured_reason ?? null,
    vendorReportedTimeField: row.vendor_reported_time_field ?? null,
    vendorReportedTimeValue: row.vendor_reported_time_value ?? null,
    fetchedAt: row.fetched_at as string,
    // The projection PRODUCTION performs on this column, not an omission. `loadStoredMeasurements`
    // runs the stored `report` jsonb through `readStoredReport`, and a double that skipped it
    // would hand the renderer a shape the real reader never returns — the round trip this file
    // exists to prove would then be proving something else (signed lesson 12). Nothing here type-
    // checks it either: `tsc --noEmit` excludes `src/**/*.test.ts`.
    report: readStoredReport(row.report, row.best_rank_group ?? null, row.best_rank_absolute ?? null),
  });

  return {
    rows,
    write: async (target: SerpMeasurementTarget, written: readonly SerpKeywordRow[]) => {
      for (const row of written) rows.push(measurementRow(target, row));
    },
    count: (async (userId, filter) =>
      rows.filter((row) => matches(row, userId, filter)).length) as CountMeasurementsFn,
    load: (async (userId, filter, limit) =>
      rows
        .filter((row) => matches(row, userId, filter))
        .sort((a, b) => String(b.fetched_at).localeCompare(String(a.fetched_at)))
        .slice(0, limit)
        .map(project)) as LoadMeasurementsFn,
  };
}

describe("a MEASURED reading survives the round trip and reads back under its own locale + device", () => {
  /**
   * THE ONE THING PRODUCTION HAS NEVER DONE. A snapshot on the fixture's ranking domain stores a
   * row whose `status` is NOT `not_measured`, and `keyword_positions` reads that row back under the
   * same location, language and device and prints the vendor's own two ranks.
   */
  it("stores a ranked row and keyword_positions reads it back with the vendor's ranks", async () => {
    const table = memoryTable();
    const snapshot = makeSerpSnapshotTool({
      port: createMockSerpSnapshotPort(rankedFixture, CLOCK),
      writeMeasurements: table.write,
    });
    await snapshot.run(CTX, {
      target: RANKED_TARGET,
      keywords: ["seo software"],
      location_name: "Germany",
      language_code: "de",
      device: "mobile",
    });

    // The row on disk is a MEASUREMENT, not a failure to measure.
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.status).toBe("ranked");
    expect(table.rows[0]?.status).not.toBe("not_measured");
    expect(table.rows[0]?.not_measured_reason).toBeNull();

    const positions = makeKeywordPositionsTool({
      countMeasurements: table.count,
      loadMeasurements: table.load,
    });
    const read = await positions.run(CTX, {
      target: RANKED_TARGET,
      location_name: "Germany",
      language_code: "de",
      device: "mobile",
    });
    expect(read.isError).toBeUndefined();
    const text = read.content[0]?.type === "text" ? read.content[0].text : "";
    // The vendor's own two scales, under their own names — nothing invented on the way out.
    expect(text).toContain("rank_group #3");
    expect(text).toContain("rank_absolute 4");
    // …and the sentence reserved for an unmeasured reading is nowhere on the page.
    expect(text).not.toContain("NOT MEASURED");
  });

  /**
   * THE SAME ROW UNDER A DIFFERENT DEVICE IS NOT THIS ROW. Without this, the read above would pass
   * against a table that ignored every filter it was handed — which is precisely the shape that
   * turns a missing constraint into a green test.
   */
  it("does not answer a mobile reading to a desktop question", async () => {
    const table = memoryTable();
    const snapshot = makeSerpSnapshotTool({
      port: createMockSerpSnapshotPort(rankedFixture, CLOCK),
      writeMeasurements: table.write,
    });
    await snapshot.run(CTX, {
      target: RANKED_TARGET,
      keywords: ["seo software"],
      location_name: "Germany",
      language_code: "de",
      device: "mobile",
    });

    const positions = makeKeywordPositionsTool({
      countMeasurements: table.count,
      loadMeasurements: table.load,
    });
    const wrongDevice = await positions.run(CTX, { target: RANKED_TARGET, device: "desktop" });
    expect(wrongDevice.isError).toBe(true);
    const wrongTenant = await positions.run(
      { userId: "user-2", keyId: "key-2" },
      { target: RANKED_TARGET, device: "mobile" },
    );
    expect(wrongTenant.isError).toBe(true);
  });
});
