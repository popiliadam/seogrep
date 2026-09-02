/**
 * A RECORDING PostgREST query builder for the fast (DB-less) lane.
 *
 * WHY IT EXISTS. Nine constraints in this codebase were measured on 2026-09-02 as pinned by
 * `*.db.test.ts` and by nothing else — tenant filters on service-role reads and writes, an
 * upsert conflict target, a composite cursor, an archive-stamp filter. `make verify` does not
 * run that lane (CLAUDE.md command table: "DB şeritleri YOK"), so every one of those
 * constraints could be deleted with the daily gate staying green; six such mutations were run
 * and all six left 3680 tests passing. The tool-level specs cannot see them because the tools
 * INJECT their readers and writers as ports, so the production query never runs at all.
 *
 * WHAT IT DOES, AND — MORE IMPORTANTLY — WHAT IT DOES NOT.
 *
 *   IT RECORDS. Every chained call is appended to the statement that `.from(table)` opened, in
 *   order, with its arguments. A spec asserts on THE CHAIN: that `.eq("user_id", userId)` is in
 *   the statement, that the upsert's conflict target names the tenant column, that the cursor
 *   is composite.
 *
 *   IT DOES NOT FILTER. `.eq(…)`, `.is(…)`, `.in(…)` change nothing about what comes back; the
 *   answer callback decides that from the table name alone. This is DELIBERATE and it is the
 *   whole safety argument of the file (signed lesson 12, fifth case: "a fake builder that
 *   records filters and does not APPLY them turns a missing constraint into a passing test").
 *   A double that pretended to filter would let a spec assert on RESULT ROWS — and a spec that
 *   asserts on rows this fake produced is asserting about the fake. So:
 *
 *     ROWS ARE NEVER THE EVIDENCE FOR A FILTER. A filter is proven by finding it in
 *     `statement.calls`, never by observing that a row did or did not come back.
 *
 *   The one legitimate use of the returned rows is a spec about how the CALLER INTERPRETS an
 *   answer it was given (e.g. "a row whose `account_id` is null reads as not connected"), which
 *   is a claim about the caller, not about the query.
 *
 * The fake is a plain object cast to `ServiceClient`. The cast is unavoidable — supabase-js's
 * builder type is generated from the database schema and is not implementable by hand — and it
 * is confined to this file so no spec repeats it.
 */
import type { ServiceClient } from "../db.ts";

/** One recorded call in a statement's chain. */
export interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Everything one `.from(table)` statement asked for, in call order. */
export interface RecordedStatement {
  readonly table: string;
  readonly calls: readonly RecordedCall[];
}

/** What an awaited statement resolves to — the shape supabase-js returns. */
export interface FakeResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
  readonly count: number | null;
}

/**
 * Decides what one statement answers, from the statement itself. It is called at AWAIT time, so
 * the full chain is already recorded and the callback may branch on it (e.g. a `maybeSingle()`
 * anchor read versus the list read on the same table).
 */
export type AnswerFn = (statement: RecordedStatement) => Partial<FakeResult>;

/** The builder methods a statement may chain. Recorded, never honoured. */
const CHAIN_METHODS = [
  "select",
  "insert",
  "update",
  "upsert",
  "delete",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is",
  "in",
  "like",
  "ilike",
  "not",
  "or",
  "filter",
  "order",
  "limit",
  "range",
  "maybeSingle",
  "single",
] as const;

type ChainMethod = (typeof CHAIN_METHODS)[number];

type Chain = Record<ChainMethod, (...args: readonly unknown[]) => Chain> &
  PromiseLike<FakeResult>;

interface MutableStatement {
  readonly table: string;
  readonly calls: RecordedCall[];
}

/** A statement nobody configured: no rows, no error — and `null` for a single-row read. */
function defaultAnswer(statement: RecordedStatement): Partial<FakeResult> {
  const single = statement.calls.some(
    (call) => call.method === "maybeSingle" || call.method === "single",
  );
  return single ? { data: null } : { data: [], count: 0 };
}

function makeChain(statement: MutableStatement, answer: AnswerFn): Chain {
  const chain: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    chain[method] = (...args: readonly unknown[]): Chain => {
      statement.calls.push({ method, args });
      return chain as unknown as Chain;
    };
  }
  chain.then = <A, B>(
    onFulfilled?: ((value: FakeResult) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> => {
    const given = answer(statement);
    const result: FakeResult = {
      data: given.data ?? defaultAnswer(statement).data ?? null,
      error: given.error ?? null,
      count: given.count ?? null,
    };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return chain as unknown as Chain;
}

export interface FakeQueryDb {
  /** Hand this to production code that expects a service-role client. */
  readonly client: ServiceClient;
  /** Every statement opened, in the order `.from()` was called. */
  readonly statements: readonly RecordedStatement[];
  /** The statements opened on one table (a reader may open more than one). */
  statementsFor(table: string): RecordedStatement[];
  /** The single statement on one table — throws when there is not exactly one. */
  onlyStatementFor(table: string): RecordedStatement;
}

export function createFakeQueryDb(answer: AnswerFn = defaultAnswer): FakeQueryDb {
  const statements: MutableStatement[] = [];
  const client = {
    from(table: string): Chain {
      const statement: MutableStatement = { table, calls: [] };
      statements.push(statement);
      return makeChain(statement, answer);
    },
  };
  const statementsFor = (table: string): RecordedStatement[] =>
    statements.filter((statement) => statement.table === table);
  return {
    client: client as unknown as ServiceClient,
    statements,
    statementsFor,
    onlyStatementFor(table: string): RecordedStatement {
      const found = statementsFor(table);
      if (found.length !== 1) {
        throw new Error(
          `expected exactly one statement on "${table}", saw ${found.length} ` +
            `(tables opened: ${statements.map((s) => s.table).join(", ") || "none"})`,
        );
      }
      return found[0] as RecordedStatement;
    },
  };
}

/** Every recorded call of one method, in chain order. */
export function callsTo(statement: RecordedStatement, method: string): RecordedCall[] {
  return statement.calls.filter((call) => call.method === method) as RecordedCall[];
}
