import { vi } from "vitest";

/**
 * The PostgREST-ish fake the /app/connection action specs run against — extracted here when
 * `actions.ts` was split (Task 8.5), so `actions.test.ts` and `tracking-actions.test.ts` drive
 * ONE fake rather than two that could drift apart.
 *
 * `lib/gsc/accounts.ts` and the actions' own `gsc_connections` statements are NOT mocked; they
 * run for REAL against these tables, so a forgotten tenant filter is VISIBLE — an unfiltered
 * delete takes another user's row out of `db.rows` and the isolation specs go red.
 *
 * All mutable state hangs off ONE exported object rather than module-level `let`s, because an
 * imported binding cannot be reassigned from a spec. Reads and writes therefore look the same
 * in both test files: `db.rows`, `db.tables`, `db.statements`, `db.ops`, `db.errors`, `db.hooks`.
 *
 * It lives in `fixtures/` — a subdirectory — on purpose: `rsc-boundary.test.ts` derives the
 * server modules it scans from a NON-recursive `readdirSync` of the connection directory, so a
 * test-only module placed beside `page.tsx` would be scanned as production code.
 */

/** A fake row of either GSC table — column bag, so one builder serves both. */
export type Row = Record<string, unknown>;
export type Filter = { column: string; value: unknown };
/** One issued statement: which table, which verb, and every filter it carried. */
export type Statement = { table: string; op: string; filters: Filter[] };

export interface FakeDb {
  /** The tables, by name. Assign a whole new map to seed a spec. */
  rows: Record<string, Row[]>;
  /**
   * PostgREST failures to inject, keyed `op:table` — the fake's only way to fail a statement.
   * A DB error is the one thing these actions cannot be observed handling any other way, and
   * every one of them must surface: a swallowed write error tells the user their mapping was
   * saved when it was not, and a swallowed count error would let `describeDisconnect` promise
   * that ZERO projects are affected.
   */
  errors: Record<string, { message: string }>;
  /**
   * Fired just BEFORE a statement runs, keyed `op:table`. The one thing this fake could not
   * otherwise express: the world changing BETWEEN two statements of the SAME action — a project
   * row deleted, or handed to another owner, after the ownership read found it and before the
   * write lands on it. That race is precisely what the zero-row proof on each UPDATE exists for,
   * and without a hook the read and the write always agree, so the proof would look untestable
   * (and, being untestable, would be deleted by the next person who tidies).
   */
  hooks: Record<string, () => void>;
  /** Every table the service client was asked for, in order — "was this even reached?". */
  tables: string[];
  /** Every statement issued, with its filters — the tenant-filter proofs read this. */
  statements: Statement[];
  /** Every side effect in order, including the Google revoke — the ordering proof. */
  ops: string[];
}

export const db: FakeDb = {
  rows: { gsc_accounts: [], gsc_connections: [], projects: [] },
  errors: {},
  hooks: {},
  tables: [],
  statements: [],
  ops: [],
};

/** Back to an empty stack: the whole state, so nothing leaks from one spec into the next. */
export function resetDb(): void {
  db.rows = { gsc_accounts: [], gsc_connections: [], projects: [] };
  db.errors = {};
  db.hooks = {};
  db.tables = [];
  db.statements = [];
  db.ops = [];
}

/**
 * Rows this fake mints an `id` for, because production does: `projects.id` defaults to
 * `gen_random_uuid()` and `openProjectForDomain` reads that id straight back out of the INSERT
 * to map a property to it. `gsc_connections` is deliberately NOT minted — its specs assert the
 * written payload byte for byte and no action reads that row's id back, so giving it a column
 * production would give it too would only make those assertions lie about what was written.
 */
let mintedIds = 0;
function mintId(table: string, payload: Row): Row {
  return table === "projects" && payload.id === undefined
    ? { id: `minted-project-${(mintedIds += 1)}`, ...payload }
    : payload;
}

/** A statement reaches a row only when EVERY filter it carried matches — like PostgREST. */
function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => row[f.column] === f.value);
}

/** Return only the columns the statement asked for, as PostgREST does. */
function project(row: Row, columns: string): Row {
  const wanted = columns.split(",").map((column) => column.trim());
  return Object.fromEntries(wanted.map((column) => [column, row[column]]));
}

/** Record the statement and hand back the failure injected for it, if any. */
function record(table: string, op: string, filters: Filter[]): { message: string } | null {
  db.statements.push({ table, op, filters });
  db.ops.push(`${op}:${table}`);
  db.hooks[`${op}:${table}`]?.();
  return db.errors[`${op}:${table}`] ?? null;
}

/** The filters carried by the one statement of this shape — fails loudly if there are several. */
export function filtersOf(table: string, op: string): Filter[] {
  const hits = db.statements.filter((s) => s.table === table && s.op === op);
  const [only, ...rest] = hits;
  if (!only || rest.length > 0) {
    throw new Error(`expected exactly one ${op} on ${table}, saw ${hits.length}`);
  }
  return only.filters;
}

/**
 * A PostgREST-ish builder over `db.rows`. `lib/gsc/accounts.ts` and the actions' own
 * gsc_connections statements (NOT mocked here) run for REAL against it, so a forgotten
 * tenant filter would be VISIBLE: an unfiltered delete would take another user's row out of
 * `db.rows` and fail the isolation specs in the two action spec files.
 *
 * The gsc_accounts DELETE also emulates migration 0021's `on delete set null` on
 * `gsc_connections.account_id`. That makes the "mappings survive" assertion meaningful about
 * THIS code — it proves the action nulls no `gsc_property` and deletes no connection row —
 * while the FK behaviour itself is pinned where it lives, in the migration's own db test.
 */
export function fakeTable(table: string) {
  const rowsIn = (): Row[] => db.rows[table] ?? [];
  return {
    select: (columns: string, options: { count?: string; head?: boolean } = {}) => {
      const filters: Filter[] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return chain;
        },
        maybeSingle: async () => {
          const error = record(table, "select", filters);
          if (error) {
            return { data: null, error };
          }
          const row = rowsIn().find((candidate) => matches(candidate, filters)) ?? null;
          return { data: row ? project(row, columns) : null, error: null };
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          const error = record(table, "select", filters);
          const found = error ? [] : rowsIn().filter((row) => matches(row, filters));
          return Promise.resolve({
            data: options.head || error ? null : found.map((row) => project(row, columns)),
            // A failed count is NULL, not 0 — the distinction the caller must not collapse.
            count: options.count && !error ? found.length : null,
            error,
          }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    update: (patch: Row) => {
      const filters: Filter[] = [];
      /**
       * Run the UPDATE and report the two things PostgREST reports SEPARATELY: whether the
       * statement failed, and which rows it actually matched. A zero-row UPDATE is not an
       * error there — `error === null` says nothing was WRONG, never that anything was
       * WRITTEN — so this fake must be able to answer `data: null, error: null`. That state is
       * the whole reason the archive/restore writes ask for the row back.
       */
      const run = (): { rows: Row[]; error: { message: string } | null } => {
        const error = record(table, "update", filters);
        if (error) {
          return { rows: [], error };
        }
        const hit = rowsIn().filter((row) => matches(row, filters));
        db.rows = {
          ...db.rows,
          [table]: rowsIn().map((row) => (matches(row, filters) ? { ...row, ...patch } : row)),
        };
        return { rows: hit.map((row) => ({ ...row, ...patch })), error: null };
      };
      const chain = {
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return chain;
        },
        select(columns: string) {
          return {
            maybeSingle: async () => {
              const { rows, error } = run();
              const [first] = rows;
              return { data: error || !first ? null : project(first, columns), error };
            },
          };
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ error: run().error }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    /**
     * PostgREST `upsert(row, { onConflict })`. There is no `.eq()` to inspect here, so the
     * CONFLICT TARGET is recorded as this statement's filters — which is exactly what it is:
     * the columns that decide WHICH row a write lands on. Dropping `user_id` from either the
     * target or the payload therefore shows up as a missing/undefined filter (constitution
     * NEVER #4), and the merge below lands on a different row, so both halves are observable.
     */
    upsert: (payload: Row, options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => {
      const target = (options.onConflict ?? "")
        .split(",")
        .map((column) => column.trim())
        .filter((column) => column.length > 0);
      /**
       * `ignoreDuplicates` is ON CONFLICT DO NOTHING: the conflicting row is left EXACTLY as
       * it is and NO row comes back. That empty answer is a signal, not an absence — it is how
       * `openProjectForDomain` learns a concurrent first call won the (user_id, domain) slot
       * between its read and its write, and must read the winner back instead of claiming it
       * inserted anything.
       */
      const run = (): { rows: Row[]; error: { message: string } | null } => {
        const error = record(
          table,
          "upsert",
          target.map((column) => ({ column, value: payload[column] })),
        );
        if (error) {
          return { rows: [], error };
        }
        const rows = rowsIn();
        const conflicting =
          target.length > 0
            ? rows.find((row) => target.every((column) => row[column] === payload[column]))
            : undefined;
        if (conflicting && options.ignoreDuplicates) {
          return { rows: [], error: null };
        }
        const stored = conflicting ? { ...conflicting, ...payload } : mintId(table, payload);
        db.rows = {
          ...db.rows,
          [table]: conflicting
            ? rows.map((row) => (row === conflicting ? stored : row))
            : [...rows, stored],
        };
        return { rows: [stored], error: null };
      };
      const chain = {
        select(columns: string) {
          return {
            then(
              onFulfilled?: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              const { rows, error } = run();
              return Promise.resolve({
                data: error ? null : rows.map((row) => project(row, columns)),
                error,
              }).then(onFulfilled, onRejected);
            },
          };
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ error: run().error }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    delete: () => {
      const filters: Filter[] = [];
      const chain = {
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return chain;
        },
        then(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          const error = record(table, "delete", filters);
          if (error) {
            return Promise.resolve({ error }).then(onFulfilled, onRejected);
          }
          const doomed = rowsIn().filter((row) => matches(row, filters));
          const survivors = rowsIn().filter((row) => !matches(row, filters));
          const orphaned = new Set(doomed.map((row) => row.id));
          const next = { ...db.rows, [table]: survivors };
          // Migration 0021: `on delete set null`, never cascade.
          db.rows =
            table === "gsc_accounts"
              ? {
                  ...next,
                  gsc_connections: (next.gsc_connections ?? []).map((row) =>
                    orphaned.has(row.account_id) ? { ...row, account_id: null } : row,
                  ),
                }
              : next;
          return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

/**
 * The service-role client as `@pseo/db/server` hands it out. Each test file installs it through
 * its own `vi.mock` factory — vitest hoists those, so the factory imports THIS module lazily.
 */
export function fakeServiceClient() {
  return {
    from: (table: string) => {
      db.tables.push(table);
      return fakeTable(table);
    },
  };
}

/** `createServiceClient` as the mock factories return it. */
export function fakeDbServerModule() {
  return { createServiceClient: vi.fn(fakeServiceClient) };
}
