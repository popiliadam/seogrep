import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
import { SAMPLE_PULL } from "../gsc-data/fixtures.ts";
import { createFakeQueryDb, type FakeQueryDb } from "../test/fake-query.ts";

/**
 * THE HANDLER'S OWN FAST LANE — the lane generate_report did not have.
 *
 * Measured 2026-09-04 (Dilim 6, mutations M1/M2/M6) and re-measured by the referee: the ONLY
 * spec looking at `generate-report.ts` was `generate-report.db.test.ts`, which needs Docker, and
 * `make verify` does not run that lane (CLAUDE.md command table: "DB şeritleri YOK"). Three
 * mutations to a 15-credit, customer-facing tool left 4198/4198 green AND `tsc --noEmit` clean:
 *
 *   M6 (GR-1, THE MONEY ONE) — the "no data to report on" refusal turned from `throw` into
 *     `return textResult(...)`. withCredits COMMITS a handler that RETURNS, so asking for a
 *     report on an empty project would have charged 15 credits for a refusal.
 *   M1 (GR-2) — the tenant filter on the gsc_connections read. Pinned now in
 *     service-client-pins.test.ts, which drives that production query head-on.
 *   M2 (GR-9) — `pulledAt` forced to null. The tool→model wire was invisible because
 *     `report/model.test.ts` calls buildReportModel DIRECTLY: a report built from a
 *     three-month-old pull printed today's date at the top and said nothing about the age.
 *
 * HOW THIS LANE STAYS DB-LESS on a 15-credit tool. Two mocks, and each is honest about what it
 * is claiming:
 *
 *   `../db.ts` — getServiceClient answers with the RECORDING fake (test/fake-query.ts). `forUser`
 *     stays real, so `loadOwnProject`'s own tenant filter is the production one. The fake applies
 *     no filter it records, so nothing here reads rows as evidence of a filter (signed lesson 12).
 *
 *   `../credits/guard.ts` — withCredits is replaced by a pass-through that RESTATES the contract
 *     the real guard documents: run the handler, COMMIT when it returns, RELEASE when it throws.
 *     What the specs then assert is which of those two the handler CHOSE, which is exactly the
 *     axis M6 moved. The real reserve/commit/release chain is proven against the real ledger in
 *     `generate-report.db.test.ts`; this file makes no claim about it and could not.
 */

const CTX: AuthContext = { userId: "user-under-test", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
const REPORT_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const WEB_BASE_URL = "https://app.test.seogrep.example";

/** Rebound by each spec before the code under test runs; the mock reads it lazily. */
let db: FakeQueryDb = createFakeQueryDb();

/** How the guard settled the run: what the handler's throw-or-return actually decided. */
type Settlement = "committed" | "released";
let settlement: Settlement | null = null;

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => db.client,
}));

vi.mock("../credits/guard.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credits/guard.ts")>()),
  withCredits: async <T>(_ctx: unknown, _meta: unknown, fn: () => Promise<T>): Promise<T> => {
    try {
      const result = await fn();
      settlement = "committed";
      return result;
    } catch (error) {
      settlement = "released";
      throw error;
    }
  },
}));

import { makeGenerateReportTool, type GenerateReportDeps } from "./generate-report.ts";
import { projectNotFoundMessage } from "./project-target.ts";
import { PreconditionNotMetError } from "./precondition.ts";

/** An answer callback that resolves the project read and the report insert, nothing else. */
function withProjectAndInsert(): void {
  db = createFakeQueryDb((statement) =>
    statement.table === "projects"
      ? { data: { id: PROJECT_ID, domain: "example.com", archived_at: null } }
      : { data: { id: REPORT_ID } },
  );
}

/** The tool with every port supplied except the two DB reads the fake above answers. */
function buildTool(deps: GenerateReportDeps = {}) {
  return makeGenerateReportTool({
    loadCrawl: async () => ({ ok: false, error: "no crawl" }),
    loadPull: async () => ({ ok: false, error: "no pull" }),
    isGscConnected: async () => false,
    randomBytes: () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    now: () => new Date("2026-09-05T09:00:00.000Z"),
    resolveWebBaseUrl: () => WEB_BASE_URL,
    ...deps,
  });
}

/** Run the tool and hand back both the rejection and how the guard settled. */
async function runExpectingRefusal(deps: GenerateReportDeps = {}): Promise<Error> {
  settlement = null;
  let caught: Error | null = null;
  try {
    await buildTool(deps).run(CTX, { project_id: PROJECT_ID });
  } catch (error) {
    caught = error as Error;
  }
  expect(caught, "the handler RETURNED where it was supposed to throw").not.toBeNull();
  return caught as Error;
}

/**
 * GR-1 — THE REFUSAL THAT MUST STAY FREE.
 *
 * `generate_report` is charge:"surface": the reserve is open before the handler runs, and the
 * registry commits whatever the handler RETURNS. So "there is nothing to report on" is a money
 * decision, not a wording one — the throw IS the refund. This is the axis M6 moved, and nothing
 * in the fast lane moved with it.
 */
describe("generate_report refuses for free when there is nothing to report on (GR-1)", () => {
  it("throws a TYPED refusal — the guard releases — when there is no crawl and no pull", async () => {
    withProjectAndInsert();
    const error = await runExpectingRefusal();

    expect(error).toBeInstanceOf(PreconditionNotMetError);
    expect(error.message).toMatch(/no crawl or search console data/i);
    // TYPED matters as much as thrown: a plain Error would reach the caller as the generic
    // "failed unexpectedly, quote reference X" instead of this actionable sentence.
    expect(error.message).toMatch(/run crawl_site or pull_gsc_data first/i);
    expect(settlement).toBe("released");
  });

  /**
   * The refund's OTHER half, and the one a wording pin cannot see: a released run must also leave
   * no report behind. The insert is the last step before the return, so a handler that refused
   * correctly never opened a `reports` statement at all.
   */
  it("writes no report row on the refusal path", async () => {
    withProjectAndInsert();
    await runExpectingRefusal();
    expect(db.statementsFor("reports")).toHaveLength(0);
  });

  /** GR-8 in the fast lane: the family's shared sentence, and free by the same throw. */
  it("an unresolvable project id gets the SHARED sentence, also for free", async () => {
    db = createFakeQueryDb(() => ({ data: null }));
    const error = await runExpectingRefusal();

    expect(error).toBeInstanceOf(PreconditionNotMetError);
    expect(error.message).toBe(projectNotFoundMessage(PROJECT_ID));
    expect(error.message).toMatch(/run list_projects/i);
    expect(settlement).toBe("released");
    expect(db.statementsFor("reports")).toHaveLength(0);
  });
});

/**
 * GR-9 — THE TOOL→MODEL WIRE, which is a different claim from "the model renders pulledAt".
 *
 * `report/model.test.ts:669` pins the model: hand buildReportModel a `pulledAt` and it survives
 * into the summary. It cannot see whether the TOOL passes one, and M2 proved it does not have to:
 * forcing `pulledAt` to null left every one of those model specs green. So this spec drives the
 * whole tool and looks for the date in the HTML it stored.
 */
describe("generate_report carries the pull's age into the stored HTML (GR-9)", () => {
  const PULLED_AT = "2026-07-18T06:30:00.000Z";

  /** Drive the happy path and return the html the tool handed to the reports insert. */
  async function storedHtml(): Promise<string> {
    settlement = null;
    withProjectAndInsert();
    const result = await buildTool({
      loadPull: async () => ({ ok: true, pull: SAMPLE_PULL, pulledAt: PULLED_AT }),
      isGscConnected: async () => true,
    }).run(CTX, { project_id: PROJECT_ID });

    expect(result.isError).toBeFalsy();
    const insert = db.onlyStatementFor("reports");
    const row = insert.calls.find((call) => call.method === "insert")?.args[0] as {
      html?: string;
      tool?: string;
      public_slug?: string;
    };
    expect(row?.tool).toBe("generate_report");
    expect(row?.public_slug, "no slug was minted").toBeTruthy();
    return row?.html ?? "";
  }

  it("prints WHEN the pull ran, not only which days it covers", async () => {
    const html = await storedHtml();
    // The AGE axis: the window dates are the model's and were already pinned; this is the one
    // the tool alone can drop.
    expect(html).toContain("Pulled 2026-07-18");
    expect(settlement).toBe("committed");
  });

  it("still prints the window, so the two axes are not confused for each other", async () => {
    const html = await storedHtml();
    expect(html).toContain(SAMPLE_PULL.current.start_date);
    expect(html).toContain(SAMPLE_PULL.current.end_date);
  });
});
