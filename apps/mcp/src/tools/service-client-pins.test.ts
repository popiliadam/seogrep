import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../auth.ts";
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
 * Findings closed here: LCA B-4 · LJ B-2 · LP B-1 · UP-1 · TK F-1 · TGP-1 · CG-1 (mapping read).
 */

const USER = "user-under-test";
const CTX: AuthContext = { userId: USER, keyId: "key-1" };

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
import { listProjectsTool } from "./list-projects.ts";
import { loadOwnGscMapping } from "./connect-gsc.ts";
import type { ProjectResolution } from "./setup-project.ts";
import { makeTrackGscPropertyTool } from "./track-gsc-property.ts";
import {
  countActiveTrackedKeywords,
  listActiveTrackedKeywords,
  untrackKeywords,
} from "./tracked-keywords-store.ts";
import { archiveOwnProject } from "./untrack-project.ts";

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

/**
 * LP B-1 — `list-projects.ts:305`, and the ONE block here that reads rows rather than a chain,
 * because the claim is about interpretation: given a `gsc_connections` row, what does this tool
 * say about it?
 *
 * Defect #52: connected is `account_id !== null`, NOT the existence of the row. Since migration
 * 0021 the row is a MAPPING — `unmapProject` keeps it and nulls the column, and deleting a Google
 * account nulls `account_id` on every project of that account. Forcing the check to `false`
 * (i.e. reading row existence again) left 156/156 green on 2026-09-02, while the same defect had
 * been measured LIVE on four of eighteen projects on 2026-08-27.
 *
 * BOTH states in one fixture (signed lesson 14): a mutation that flips the ternary either way
 * reddens, because the live project must still read as connected.
 */
describe("a mapping with no credential is NOT connected (LP B-1)", () => {
  const DEAD_PROPERTY = "https://unmapped-credential.example/";
  const LIVE_PROPERTY = "https://working-credential.example/";

  async function listing(): Promise<string> {
    db = createFakeQueryDb((statement) => {
      if (statement.table === "projects") {
        return {
          data: [
            {
              id: "p-dead",
              domain: "dead-account.example",
              created_at: "2026-01-01T00:00:00.000Z",
              archived_at: null,
            },
            {
              id: "p-live",
              domain: "live-account.example",
              created_at: "2026-01-02T00:00:00.000Z",
              archived_at: null,
            },
          ],
        };
      }
      if (statement.table === "gsc_connections") {
        return {
          data: [
            { project_id: "p-dead", account_id: null, gsc_property: DEAD_PROPERTY },
            { project_id: "p-live", account_id: "acct-1", gsc_property: LIVE_PROPERTY },
          ],
        };
      }
      if (statement.table === "gsc_accounts") {
        return { data: [{ id: "acct-1", token_status: null }] };
      }
      return { data: [] };
    });
    const result = await listProjectsTool.run(CTX, {});
    expect(result.isError).toBeUndefined();
    return result.content[0]?.text ?? "";
  }

  it("reports a null account_id as not connected, and names the retained property", async () => {
    const text = await listing();
    expect(text).toMatch(
      new RegExp(String.raw`not connected — ${DEAD_PROPERTY} is still mapped`, "i"),
    );
  });

  it("still reports the project whose account_id is set as connected", async () => {
    const text = await listing();
    expect(text).toContain(`Search Console: ${LIVE_PROPERTY}`);
    // …and does not describe the live one as the dead one.
    expect(text).not.toMatch(
      new RegExp(String.raw`not connected — ${LIVE_PROPERTY}`, "i"),
    );
  });

  it("reads the mapping columns the decision needs", async () => {
    await listing();
    const connections = db.onlyStatementFor("gsc_connections");
    const columns = String(callsTo(connections, "select")[0]?.args[0] ?? "");
    // A projection that stopped asking for `account_id` would make the check above unanswerable
    // — and PostgREST would hand back `undefined`, which is not null.
    expect(columns).toContain("account_id");
    expect(connections.calls).toContainEqual(tenantFilter);
  });
});

/**
 * UP-1 — `untrack-project.ts:68`. Deleting `.eq("user_id", userId)` from the archive UPDATE left
 * 143 files / 3680 tests green. This is the WRITE side of NEVER #4 and it is not a duplicate of
 * the ownership read that precedes it: the client is service-role and bypasses RLS, so that one
 * call is all that stands between a stray project id and another tenant's row.
 *
 * The zero-row proof is pinned in the same breath, because the two are one guarantee: a write
 * that matched nothing is not an error in PostgREST, so the statement has to ask for the row back
 * or "stopped tracking" becomes a sentence nobody checked.
 */
describe("the archive write is tenant-filtered, and proves it matched (UP-1)", () => {
  const PROJECT = "8f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

  async function archive(): Promise<RecordedStatement> {
    db = createFakeQueryDb(() => ({ data: { id: PROJECT } }));
    await archiveOwnProject(USER, PROJECT);
    return db.onlyStatementFor("projects");
  }

  it("filters the UPDATE by user_id as well as by id", async () => {
    const statement = await archive();
    expect(callsTo(statement, "update")).toHaveLength(1);
    expect(statement.calls).toContainEqual(tenantFilter);
    expect(statement.calls).toContainEqual({ method: "eq", args: ["id", PROJECT] });
  });

  it("asks the row back, so a zero-row UPDATE cannot read as a success", async () => {
    const statement = await archive();
    expect(callsTo(statement, "select")).toHaveLength(1);
    expect(callsTo(statement, "maybeSingle")).toHaveLength(1);
    // …and the function's answer really is derived from that row, not from the absent error.
    db = createFakeQueryDb(() => ({ data: null }));
    await expect(archiveOwnProject(USER, PROJECT)).resolves.toBe(false);
  });
});

/**
 * TK F-1 — `tracked-keywords-store.ts:216`. Dropping `.is("untracked_at", null)` from the untrack
 * UPDATE left 143 files / 3680 tests green, because the tool injects `untrack` as a port and the
 * real statement never runs in the fast lane.
 *
 * What that filter carries is a promise made in THREE places — the tool description, the docs page
 * and the live answer: "untracking something twice does not change that date either". Without it,
 * a second call re-stamps `untracked_at`, and the reply contradicts itself in one breath —
 * `classify` still builds the "already archived" list from the rows it read, while the write now
 * reports those same rows as freshly stopped.
 */
describe("the untrack write only touches rows that are still active (TK F-1)", () => {
  const IDENTITY = {
    projectId: "3c9f0b21-4d5e-4f60-9a7b-8c9d0e1f2a3b",
    locationName: "United States",
    languageCode: "en",
    device: "desktop",
  } as const;

  async function untrack(): Promise<RecordedStatement> {
    db = createFakeQueryDb(() => ({ data: [{ keyword: "seo audit" }] }));
    await untrackKeywords(USER, IDENTITY, ["seo audit"]);
    return db.onlyStatementFor("tracked_keywords");
  }

  it("filters on `untracked_at is null`, so a second call matches nothing", async () => {
    expect((await untrack()).calls).toContainEqual({
      method: "is",
      args: ["untracked_at", null],
    });
  });

  it("carries the tenant filter and the whole identity on the same UPDATE", async () => {
    const statement = await untrack();
    expect(callsTo(statement, "update")).toHaveLength(1);
    expect(statement.calls).toContainEqual(tenantFilter);
    for (const [column, value] of [
      ["project_id", IDENTITY.projectId],
      ["location_name", IDENTITY.locationName],
      ["language_code", IDENTITY.languageCode],
      ["device", IDENTITY.device],
    ] as const) {
      expect(statement.calls, column).toContainEqual({ method: "eq", args: [column, value] });
    }
  });
});

/**
 * TGP-1 — `track-gsc-property.ts:87`. The mapping upsert's conflict target
 * (`onConflict: "user_id,project_id"`) was pinned by NOTHING: the fast lane injects
 * `mapProperty`, and the db lane names the target only inside a comment
 * (`track-gsc-property.db.test.ts:282` — a claim with no `expect` under it). Dropping the tenant
 * id from the target left 3680 tests green.
 *
 * That migration 0010's unique index would probably make PostgREST complain at runtime is not a
 * gate, it is a coincidence — and the shape it produces is a raw `gsc_connections upsert failed:`
 * error handed to a customer.
 *
 * The DEFAULT port is what runs here: every other port is injected, `mapProperty` deliberately is
 * not, so the production write is the one being recorded.
 */
describe("the property mapping upsert names the tenant in its conflict target (TGP-1)", () => {
  const PROJECT = "5b6c7d8e-9f01-4a2b-8c3d-4e5f60718293";
  const ACCOUNT = "2a3b4c5d-6e7f-4081-9a2b-3c4d5e6f7081";
  const PROPERTY = "https://mapped-under-test.example/";

  async function trackProperty(): Promise<RecordedStatement> {
    db = createFakeQueryDb(() => ({ data: [], count: 0 }));
    const tool = makeTrackGscPropertyTool({
      loadAccounts: () => Promise.resolve([{ id: ACCOUNT, email: "owner@example.com" }]),
      listAccountSites: () =>
        Promise.resolve([{ siteUrl: PROPERTY, permissionLevel: "siteOwner" }]),
      openProject: () =>
        Promise.resolve({
          ok: true,
          project: {
            id: PROJECT,
            domain: "mapped-under-test.example",
            outcome: "created",
          },
        } satisfies ProjectResolution),
      // mapProperty is NOT injected — the production writer is the subject of this block.
    });
    const result = await tool.run(CTX, { property: PROPERTY });
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    return db.onlyStatementFor("gsc_connections");
  }

  it("upserts on EXACTLY (user_id, project_id) — no fewer columns, and no more", async () => {
    const upserts = callsTo(await trackProperty(), "upsert");
    expect(upserts).toHaveLength(1);
    const target = upserts[0]?.args[1] as { onConflict?: string } | undefined;
    const columns = (target?.onConflict ?? "").split(",").map((column) => column.trim());
    // THE WHOLE SET, order-independent — `toContain` was too loose (referee, 2026-09-02): it
    // admitted any SUPERSET, and `"user_id,project_id,account_id"` is a real regression, not a
    // hypothetical one. A wider target matches migration 0010's unique index on nothing, so the
    // upsert stops folding onto the existing row and starts inserting a second mapping.
    expect([...columns].sort()).toEqual(["project_id", "user_id"]);
  });

  it("writes the tenant id as a column too, not only in the conflict target", async () => {
    const upserts = callsTo(await trackProperty(), "upsert");
    expect(upserts[0]?.args[0]).toMatchObject({
      user_id: USER,
      project_id: PROJECT,
      account_id: ACCOUNT,
      gsc_property: PROPERTY,
    });
  });
});

/**
 * TK F-1, READ SIDE — found by the referee on 2026-09-02, after the write side was pinned.
 *
 * The same two constraints ride on the two reads the cap and the listing are built from, and both
 * were invisible: deleting `.is("untracked_at", null)` or `.eq("user_id", …)` from either one left
 * 144/144 green. The pair matters more than either alone. Lose the archive filter on the COUNT and
 * the per-project cap starts counting keywords the customer already stopped tracking, so a project
 * well under the cap is refused; lose it on the LIST and untracked keywords come back as tracked.
 * Lose the tenant filter and both answers are the fleet's.
 */
describe("the tracked_keywords reads are tenant-scoped and archive-aware (TK F-1)", () => {
  const PROJECT = "3c9f0b21-4d5e-4f60-9a7b-8c9d0e1f2a3b";
  const ACTIVE_ONLY = { method: "is", args: ["untracked_at", null] };
  const PROJECT_SCOPE = { method: "eq", args: ["project_id", PROJECT] };

  it("the listing reads only this tenant's ACTIVE rows for this project", async () => {
    db = createFakeQueryDb(() => ({
      data: [
        {
          keyword: "seo audit",
          location_name: "United States",
          language_code: "en",
          device: "desktop",
        },
      ],
    }));
    await listActiveTrackedKeywords(USER, PROJECT);
    const statement = db.onlyStatementFor("tracked_keywords");
    expect(statement.calls).toContainEqual(tenantFilter);
    expect(statement.calls).toContainEqual(PROJECT_SCOPE);
    expect(statement.calls).toContainEqual(ACTIVE_ONLY);
  });

  it("the cap's count does the same, and counts in the database rather than in hand", async () => {
    db = createFakeQueryDb(() => ({ data: null, count: 7 }));
    await expect(countActiveTrackedKeywords(USER, PROJECT)).resolves.toBe(7);
    const statement = db.onlyStatementFor("tracked_keywords");
    expect(statement.calls).toContainEqual(tenantFilter);
    expect(statement.calls).toContainEqual(PROJECT_SCOPE);
    expect(statement.calls).toContainEqual(ACTIVE_ONLY);
    // `head: true` with an exact count — PostgREST's 1000-row page would silently under-count a
    // project at the cap, which is the one place the number has to be right.
    expect(callsTo(statement, "select")[0]?.args[1]).toMatchObject({
      count: "exact",
      head: true,
    });
  });
});

/**
 * CG-1, THE READ THE PORT SEAM CREATED — found by the referee on 2026-09-02, and a fair finding
 * about this very slice: extracting `loadOwnGscMapping` out of the handler moved the tenant filter
 * into a new default port, and a new default port is a new place with no gate. Deleting
 * `.eq("user_id", userId)` from it left 144/144 green.
 *
 * The three calls are one guarantee, not three preferences: `user_id` is the whole of NEVER #4 on
 * an RLS-bypassing client, `project_id` is what makes the row THIS project's, and `maybeSingle`
 * is what lets "no mapping" be an answer instead of an error.
 */
describe("the connect_gsc mapping read is scoped to one tenant's one project (CG-1)", () => {
  const PROJECT = "6d7e8f90-1a2b-4c3d-8e4f-506172839405";

  async function readMapping(): Promise<RecordedStatement> {
    db = createFakeQueryDb(() => ({ data: { account_id: null, gsc_property: null } }));
    await loadOwnGscMapping(USER, PROJECT);
    return db.onlyStatementFor("gsc_connections");
  }

  it("filters by user_id AND project_id, and asks for at most one row", async () => {
    const statement = await readMapping();
    expect(statement.calls).toContainEqual(tenantFilter);
    expect(statement.calls).toContainEqual({ method: "eq", args: ["project_id", PROJECT] });
    expect(callsTo(statement, "maybeSingle")).toHaveLength(1);
  });

  it("projects the column the connected/not-connected decision is made from", async () => {
    const columns = String(callsTo(await readMapping(), "select")[0]?.args[0] ?? "");
    expect(columns).toContain("account_id");
    expect(columns).toContain("gsc_property");
  });
});
