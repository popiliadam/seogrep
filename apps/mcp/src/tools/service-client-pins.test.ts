import { describe, expect, it, vi } from "vitest";
import {
  callsTo,
  createFakeQueryDb,
  type FakeQueryDb,
  type RecordedStatement,
} from "../test/fake-query.ts";

/**
 * THE CONSTRAINTS THAT ONLY THE DB LANE COULD SEE — driven here without Docker.
 *
 * Measured 2026-09-02 across the 2026-09 tool review: six mutations, each deleting a real
 * constraint from a production reader or writer, left the fast lane completely green
 * (143 files / 3680 tests). Every one of them was pinned by a `*.db.test.ts` spec and by
 * nothing else — and `make verify` does not run that lane (CLAUDE.md command table:
 * "**secret taraması YOK · DB şeritleri YOK**"). The tool-level specs cannot reach these
 * constraints because the tools INJECT their readers and writers as ports, so the production
 * query never runs in the fast lane at all.
 *
 * This file drives those production functions HEAD-ON against the recording fake, and asserts on
 * THE STATEMENT THEY BUILT. The db lane keeps its own specs: it proves the constraints BEHAVE
 * against real rows, which is a claim this file cannot make and does not try to.
 *
 * THE RULE THIS FILE OBEYS, and the reason it can be trusted (signed lesson 12, fifth case).
 * The fake records the chain and applies NONE of it. So a filter is proven by finding it in
 * `statement.calls` — never by observing which rows came back, because the rows are whatever the
 * spec's own answer callback handed over. The single exception is the last block, which is a
 * claim about how a CALLER INTERPRETS an answer it was given, not about the query.
 *
 * Findings closed here: LCA B-4 · LJ B-2.
 */

const USER = "user-under-test";

/** Rebound by each spec before the code under test runs; the mock reads it lazily. */
let db: FakeQueryDb = createFakeQueryDb();

vi.mock("../db.ts", async (importOriginal) => ({
  // `forUser` stays REAL: it is where `selectOwn`'s own `.eq("user_id", …)` lives, and a faked
  // one would hand these specs the very filter they exist to look for.
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => db.client,
}));

import { listOwnCreditActivity, summarizeOwnSpend } from "./list-credit-activity.ts";
import { listOwnJobs } from "./list-jobs.ts";

/** The one shape every spec below asserts: this call, with these arguments, in this chain. */
const tenantFilter = { method: "eq", args: ["user_id", USER] };

/**
 * LCA B-4 — `list-credit-activity.ts:158`. Deleting `.eq("user_id", userId)` from the ledger read
 * left 156/156 green on 2026-09-02. The client is service-role and bypasses RLS, so that one call
 * is the whole of NEVER #4 for this query: without it, `list_credit_activity` pages through the
 * FLEET's ledger.
 *
 * BOTH statements this module builds, not just the list one (signed lesson 14, position axis):
 * the summary read carries its own guard and would otherwise be pinned by nothing.
 */
describe("the credit_ledger reads carry the tenant filter (LCA B-4)", () => {
  it("the list read filters on user_id", async () => {
    db = createFakeQueryDb(() => ({ data: [], count: 0 }));
    await listOwnCreditActivity(USER, 10);
    expect(db.onlyStatementFor("credit_ledger").calls).toContainEqual(tenantFilter);
  });

  it("the spend summary read filters on user_id too", async () => {
    db = createFakeQueryDb(() => ({ data: [], count: 0 }));
    await summarizeOwnSpend(USER);
    expect(db.onlyStatementFor("credit_ledger").calls).toContainEqual(tenantFilter);
  });

  it("the cursor's anchor probe is tenant-scoped as well", async () => {
    // An anchor read without the filter turns "is this cursor mine?" into "does this row exist
    // anywhere?" — the existence leak the module's own header rules out.
    db = createFakeQueryDb((statement) =>
      statement.calls.some((call) => call.method === "maybeSingle")
        ? { data: { id: 777 } }
        : { data: [], count: 0 },
    );
    await listOwnCreditActivity(USER, 10, 777);
    const anchor = db
      .statementsFor("credit_ledger")
      .find((statement) => statement.calls.some((call) => call.method === "maybeSingle"));
    expect(anchor, "no maybeSingle anchor read was issued").toBeDefined();
    expect(anchor?.calls).toContainEqual(tenantFilter);
  });
});

/**
 * LJ B-2 — `list-jobs.ts:150-153`. Replacing the composite cursor with `.lt("created_at", …)`
 * left 156/156 green. `jobs.id` is a uuid and carries no order, so the cursor HAS to be the same
 * pair the query orders by; `recordSucceededPull` stamps `created_at` from the caller's clock and
 * two jobs really can share a millisecond, at which point a `created_at`-only cursor silently
 * skips a job or repeats one.
 *
 * The ORDER is asserted beside the cursor on purpose: a composite cursor is only correct while
 * the query orders by that same pair, so dropping the `id` tie-break breaks the cursor without
 * touching the cursor.
 */
describe("the jobs cursor is composite, and matches the order (LJ B-2)", () => {
  const CURSOR_ID = "11111111-2222-4333-8444-555555555555";
  const CURSOR_AT = "2026-09-01T10:00:00.000Z";

  async function pageWithCursor(): Promise<{
    anchor: RecordedStatement;
    list: RecordedStatement;
  }> {
    db = createFakeQueryDb((statement) =>
      statement.calls.some((call) => call.method === "maybeSingle")
        ? { data: { id: CURSOR_ID, created_at: CURSOR_AT } }
        : { data: [], count: 0 },
    );
    await listOwnJobs(USER, 10, CURSOR_ID);
    const statements = db.statementsFor("jobs");
    const anchor = statements.find((s) => s.calls.some((c) => c.method === "maybeSingle"));
    const list = statements.find((s) => !s.calls.some((c) => c.method === "maybeSingle"));
    expect(anchor, "no anchor read").toBeDefined();
    expect(list, "no list read").toBeDefined();
    return { anchor: anchor as RecordedStatement, list: list as RecordedStatement };
  }

  it("pages on (created_at, id) together, never on created_at alone", async () => {
    const { list } = await pageWithCursor();
    const or = callsTo(list, "or");
    expect(or, "the page is not built from a composite `or(...)` at all").toHaveLength(1);
    const expression = String(or[0]?.args[0] ?? "");
    expect(expression).toContain(`created_at.lt.${CURSOR_AT}`);
    expect(expression).toMatch(/and\(\s*created_at\.eq\.[^,]+,\s*id\.lt\./);
    expect(expression).toContain(CURSOR_ID);
    // A bare `.lt("created_at", …)` beside the or() would be the same bug wearing a disguise.
    expect(callsTo(list, "lt")).toHaveLength(0);
  });

  it("orders by the SAME pair the cursor is made of", async () => {
    const { list } = await pageWithCursor();
    expect(callsTo(list, "order").map((call) => call.args)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("resolves the cursor through a tenant-scoped read", async () => {
    const { anchor } = await pageWithCursor();
    expect(anchor.calls).toContainEqual(tenantFilter);
    expect(anchor.calls).toContainEqual({ method: "eq", args: ["id", CURSOR_ID] });
  });
});
