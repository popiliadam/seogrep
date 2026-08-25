import { describe, expect, it, vi } from "vitest";

/**
 * S11 — pull_gsc_data hands its recorder the RUN's own bracket, in the fast lane.
 *
 * WHY THIS FILE EXISTS AND WHAT IT MEASURES. `recordSucceededPull` cannot know when the work
 * began: it is called once the work is over. So the correctness of `started_at` is decided HERE,
 * by where in the handler the stamp is taken — and no assertion over a stored row can tell the
 * difference between a start captured before the Google calls and one captured a line before the
 * insert. This spec pins the only property that separates them: the fake Google port records the
 * wall clock at the moment it is called, and the bracket handed to the recorder must CONTAIN it.
 *
 * TWO SUBSTITUTIONS, both named out loud (signed lesson 12 — a double kinder than the runtime is
 * how a missing constraint becomes a green test):
 *   · `../credits/guard.ts` is a PASS-THROUGH. pull_gsc_data is charge:"surface", so its real
 *     `run` opens a credit reserve against Supabase. The money behaviour is unchanged by this
 *     slice and is measured against a REAL ledger in pull-gsc-data.db.test.ts.
 *   · `./project-target.ts`'s `loadOwnProject` returns null (an id that resolves to nothing,
 *     which the handler deliberately falls through). Everything else in that module is the real
 *     export.
 * Neither substitution touches a timestamp, a clock, or the recorder. What this lane CANNOT show
 * is what Postgres stores — that is the DB lane's, and it was NOT run for this change.
 */
vi.mock("../credits/guard.ts", () => ({
  withCredits: async <T>(_ctx: unknown, _meta: unknown, fn: () => Promise<T>): Promise<T> => fn(),
  isReserveCommitFailed: () => false,
}));

vi.mock("./project-target.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project-target.ts")>()),
  loadOwnProject: async () => null,
}));

import { encryptToken, toByteaHex } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import type { GscApi } from "../gsc-data/pull.ts";
import { CURRENT_ROWS, FIXTURE_WINDOWS, PREVIOUS_ROWS, rawGoogleResponse } from "../gsc-data/fixtures.ts";
import { makePullGscDataTool, type RecordPullFn } from "./pull-gsc-data.ts";

// 64-hex (32-byte) AES-256 test key. Unmistakably a test value, never a real key.
const KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
// Same fixed reference the DB spec uses, so the windows equal FIXTURE_WINDOWS. This is the
// DOMAIN clock (which days to fetch) and deliberately NOT the lifecycle clock — the stamps
// under test come from the wall clock, which is exactly why they can be bracketed below.
const REFERENCE = new Date("2026-07-20T00:00:00Z");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

const ctx: AuthContext = { userId: USER_ID, keyId: "key-1" };

/** A sealed refresh token bound to the SAME (user, account) the fake connection names. */
const SEALED_TOKEN = toByteaHex(
  encryptToken("1//refresh-fast-lane", KEY, { userId: USER_ID, accountId: ACCOUNT_ID }),
);

interface Harness {
  readonly run: () => Promise<{ isError?: boolean; content: { text?: string }[] }>;
  /** Wall clock at the moment the fake Google port was first called. */
  readonly apiCalledAt: () => number;
  /** Everything the handler handed to the jobs recorder. */
  readonly recorded: Parameters<RecordPullFn>[0][];
}

/**
 * The tool with every port faked and ZERO network (NEVER #5). `delayMs` puts real, measurable
 * time inside the run so the bracket is a span rather than a single instant.
 */
function harness({ delayMs = 15 } = {}): Harness {
  let calledAt = 0;
  const recorded: Parameters<RecordPullFn>[0][] = [];
  const api: GscApi = {
    refreshAccessToken: async () => ({ accessToken: "ya29.fast-lane" }),
    searchAnalyticsQuery: async (_token, _property, body) => {
      if (calledAt === 0) calledAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return body.startDate === FIXTURE_WINDOWS.current.start_date
        ? rawGoogleResponse(CURRENT_ROWS)
        : rawGoogleResponse(PREVIOUS_ROWS);
    },
  };
  const tool = makePullGscDataTool({
    loadConnection: async () => ({
      account_id: ACCOUNT_ID,
      gsc_property: "sc-domain:fast-lane.example",
    }),
    loadAccountToken: async () => ({
      encrypted_refresh_token: SEALED_TOKEN,
      google_account_email: "owner@fast-lane.example",
    }),
    api,
    recordPull: async (params) => {
      recorded.push(params);
      return { jobId: "job-1" };
    },
    now: () => REFERENCE,
    encryptionKey: KEY,
  });
  return {
    run: () => tool.run(ctx, { project_id: PROJECT_ID, days: 90 }),
    apiCalledAt: () => calledAt,
    recorded,
  };
}

describe("pull_gsc_data run bracket", () => {
  it("hands the recorder a start taken BEFORE the work and a finish taken AFTER it", async () => {
    const h = harness();
    const before = Date.now();
    const result = await h.run();
    const after = Date.now();

    expect(result.isError).toBeUndefined();
    expect(h.recorded).toHaveLength(1);
    const { startedAt, finishedAt } = h.recorded[0] as Parameters<RecordPullFn>[0];

    // The whole point: the Google call happened INSIDE the recorded bracket. A start captured
    // just before the insert (or a finish captured at handler entry) fails right here.
    expect(h.apiCalledAt()).toBeGreaterThan(0);
    expect(startedAt.getTime()).toBeLessThanOrEqual(h.apiCalledAt());
    expect(finishedAt.getTime()).toBeGreaterThanOrEqual(h.apiCalledAt());

    // And the bracket sits inside the call the test itself made.
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(finishedAt.getTime()).toBeLessThanOrEqual(after);
    expect(finishedAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
  });

  /**
   * The stamps are WALL-CLOCK facts about this process, not the domain clock. `now` is pinned to
   * a 2026-07-20 reference above so the pull windows are deterministic; if the lifecycle stamps
   * were taken from it too, they would travel to that date and be compared against a `created_at`
   * the database writes from the real clock.
   */
  it("does not take the lifecycle stamps from the injected window clock", async () => {
    const h = harness();
    await h.run();
    const { startedAt } = h.recorded[0] as Parameters<RecordPullFn>[0];
    expect(startedAt.getTime()).not.toBe(REFERENCE.getTime());
  });
});
