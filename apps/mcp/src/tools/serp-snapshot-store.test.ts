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
import { createMockSerpSnapshotPort, disabledSerpSnapshotPort } from "../dfs/serp.ts";
import fixture from "../dfs/fixtures/serp-organic-live-advanced.json";
import { makeSerpSnapshotTool } from "./serp-snapshot.ts";

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
