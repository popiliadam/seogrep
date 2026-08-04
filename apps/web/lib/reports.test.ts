import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

const serviceClient = vi.fn();
vi.mock("@pseo/db/server", () => ({
  createServiceClient: () => serviceClient(),
}));

/**
 * The public lookup reads the caller address off the request to key its per-IP budget.
 * `clientIp` is the address the test is pretending to be; `headersAvailable` simulates a
 * call from outside any request scope, where next/headers throws.
 */
let clientIp: string | null = null;
let headersAvailable = true;
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!headersAvailable) throw new Error("`headers` was called outside a request scope");
    return new Headers(clientIp === null ? {} : { "x-nf-client-connection-ip": clientIp });
  },
}));

import { fetchPublicReportBySlug, listReports, revokeReportLink } from "./reports";

beforeEach(() => {
  clientIp = null;
  headersAvailable = true;
});

/** Counts service-role client constructions, i.e. actual trips to Supabase. */
function countDatabaseReads(): number {
  return serviceClient.mock.calls.length;
}

type QueryResult = { data: unknown; error: unknown };

/** A thenable query builder for the chained list read (…select().eq().order().limit()). */
function listClient(result: QueryResult): { client: SupabaseClient; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls[method] = args;
      return builder;
    };
  }
  (builder as { then: unknown }).then = (resolve: (v: QueryResult) => unknown) => resolve(result);
  const client = {
    from: (...args: unknown[]) => {
      calls.from = args;
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

/** A service client whose reports read terminates at maybeSingle(). */
function singleServiceClient(result: QueryResult): { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = (...args: unknown[]) => {
      calls[method] = args;
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve(result);
  serviceClient.mockReturnValue({
    from: (...args: unknown[]) => {
      calls.from = args;
      return builder;
    },
  });
  return { calls };
}

/** One row of the fake `reports` table below. */
interface ReportRow {
  id: string;
  user_id: string;
  title: string | null;
  html: string | null;
  public_slug: string | null;
}
type Filter = { column: string; value: unknown };

/** Rows the fake table currently holds — inspected by the revoke specs after each statement. */
let reportRows: ReportRow[] = [];

/** A statement reaches a row only when EVERY filter it carried matches — like PostgREST. */
function matchesRow(row: ReportRow, filters: Filter[]): boolean {
  return filters.every((f) => (row as unknown as Record<string, unknown>)[f.column] === f.value);
}

/**
 * A service client backed by REAL rows rather than a canned answer. lib/reports runs unmocked
 * against it, so the tenant filter is proved on the ACTUAL statement: drop `.eq("user_id", …)`
 * from the UPDATE and the write reaches another user's row, which the isolation specs below
 * catch. That matters here more than anywhere — service_role is `rolbypassrls`, so RLS (even
 * FORCE ROW LEVEL SECURITY) does not constrain this client and cannot cover a missing predicate.
 */
function reportsServiceClient(rows: readonly ReportRow[], error: unknown = null): void {
  reportRows = rows.map((row) => ({ ...row }));
  const chainOf = <T>(terminal: (filters: Filter[]) => T) => {
    const filters: Filter[] = [];
    const chain = {
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return chain;
      },
      select: () => terminal(filters),
      maybeSingle: () => terminal(filters),
    };
    return chain;
  };
  serviceClient.mockReturnValue({
    from: (table: string) => {
      if (table !== "reports") throw new Error(`unexpected table: ${table}`);
      return {
        update: (patch: Partial<ReportRow>) =>
          chainOf(async (filters) => {
            if (error) return { data: null, error };
            const hit = reportRows.filter((row) => matchesRow(row, filters));
            reportRows = reportRows.map((row) =>
              matchesRow(row, filters) ? { ...row, ...patch } : row,
            );
            return { data: hit.map((row) => ({ id: row.id })), error: null };
          }),
        select: () =>
          chainOf(async (filters) => {
            if (error) return { data: null, error };
            const row = reportRows.find((candidate) => matchesRow(candidate, filters)) ?? null;
            return { data: row ? { title: row.title, html: row.html } : null, error: null };
          }),
      };
    },
  });
}

describe("listReports", () => {
  it("maps rows to camelCased list items, tenant-scoped and newest-first", async () => {
    const { client, calls } = listClient({
      data: [
        { id: "r1", title: "Q3", created_at: "2026-07-19T00:00:00.000Z", public_slug: "abc" },
        { id: "r2", title: null, created_at: "2026-07-01T00:00:00.000Z", public_slug: null },
      ],
      error: null,
    });

    const items = await listReports(client, "user-1");
    expect(items).toEqual([
      { id: "r1", title: "Q3", createdAt: "2026-07-19T00:00:00.000Z", publicSlug: "abc" },
      { id: "r2", title: null, createdAt: "2026-07-01T00:00:00.000Z", publicSlug: null },
    ]);
    expect(calls.from).toEqual(["reports"]);
    expect(calls.eq).toEqual(["user_id", "user-1"]);
    expect(calls.order).toEqual(["created_at", { ascending: false }]);
  });

  it("returns an empty list when there are no rows", async () => {
    const { client } = listClient({ data: [], error: null });
    expect(await listReports(client, "user-1")).toEqual([]);
  });

  it("throws when the read errors", async () => {
    const { client } = listClient({ data: null, error: { message: "boom" } });
    await expect(listReports(client, "user-1")).rejects.toThrow(/listReports failed: boom/);
  });
});

describe("fetchPublicReportBySlug", () => {
  it("returns the title + html when a slug matches a row with html", async () => {
    const { calls } = singleServiceClient({
      data: { title: "Shared", html: "<main>report</main>" },
      error: null,
    });
    expect(await fetchPublicReportBySlug("slug-123")).toEqual({
      title: "Shared",
      html: "<main>report</main>",
    });
    expect(calls.eq).toEqual(["public_slug", "slug-123"]);
  });

  it("returns null when no row matches the slug", async () => {
    singleServiceClient({ data: null, error: null });
    expect(await fetchPublicReportBySlug("missing")).toBeNull();
  });

  it("returns null when the matched row has no rendered html", async () => {
    singleServiceClient({ data: { title: "Empty", html: null }, error: null });
    expect(await fetchPublicReportBySlug("no-html")).toBeNull();
  });

  it("throws when the read errors", async () => {
    singleServiceClient({ data: null, error: { message: "db down" } });
    await expect(fetchPublicReportBySlug("x")).rejects.toThrow(/fetchPublicReportBySlug failed: db down/);
  });
});

describe("fetchPublicReportBySlug flood controls (L-14)", () => {
  it("reads the database once for a slug already known to be missing", async () => {
    singleServiceClient({ data: null, error: null });
    clientIp = "198.51.100.40";

    const before = countDatabaseReads();
    expect(await fetchPublicReportBySlug("cachedmiss1")).toBeNull();
    expect(await fetchPublicReportBySlug("cachedmiss1")).toBeNull();
    expect(await fetchPublicReportBySlug("cachedmiss1")).toBeNull();
    expect(countDatabaseReads() - before).toBe(1);
  });

  it("re-reads a slug that DOES resolve, so a revoked report stops serving at once", async () => {
    singleServiceClient({ data: { title: "Live", html: "<main>live</main>" }, error: null });
    clientIp = "198.51.100.41";

    const before = countDatabaseReads();
    const first = await fetchPublicReportBySlug("liveslug1");
    const second = await fetchPublicReportBySlug("liveslug1");
    expect(first).toEqual({ title: "Live", html: "<main>live</main>" });
    expect(second).toEqual(first);
    expect(countDatabaseReads() - before).toBe(2);
  });

  it("caps the database reads one caller can spend on distinct unknown slugs", async () => {
    singleServiceClient({ data: null, error: null });
    clientIp = "198.51.100.42";

    const attempts = 200;
    const before = countDatabaseReads();
    for (let index = 0; index < attempts; index += 1) {
      expect(await fetchPublicReportBySlug(`floodslug${index}`)).toBeNull();
    }
    const reads = countDatabaseReads() - before;
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThan(attempts);
  });

  it("keeps a fresh budget per caller address", async () => {
    singleServiceClient({ data: null, error: null });

    clientIp = "198.51.100.43";
    for (let index = 0; index < 200; index += 1) {
      await fetchPublicReportBySlug(`noisyslug${index}`);
    }

    clientIp = "198.51.100.44";
    const before = countDatabaseReads();
    await fetchPublicReportBySlug("quietslug1");
    expect(countDatabaseReads() - before).toBe(1);
  });

  it("does not cache a MISS forever — the slug is re-read once the entry ages out", async () => {
    vi.useFakeTimers();
    try {
      singleServiceClient({ data: null, error: null });
      clientIp = "198.51.100.45";

      const before = countDatabaseReads();
      expect(await fetchPublicReportBySlug("agingslug1")).toBeNull();
      expect(await fetchPublicReportBySlug("agingslug1")).toBeNull();
      expect(countDatabaseReads() - before).toBe(1);

      vi.advanceTimersByTime(120_000);
      expect(await fetchPublicReportBySlug("agingslug1")).toBeNull();
      expect(countDatabaseReads() - before).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still resolves the report when there is no request scope to read an address from", async () => {
    singleServiceClient({ data: { title: "Scriptable", html: "<main>ok</main>" }, error: null });
    headersAvailable = false;

    await expect(fetchPublicReportBySlug("noscopeslug1")).resolves.toEqual({
      title: "Scriptable",
      html: "<main>ok</main>",
    });
  });

  it("does not cache a MISS caused by a failed read", async () => {
    clientIp = "198.51.100.46";
    singleServiceClient({ data: null, error: { message: "db down" } });
    await expect(fetchPublicReportBySlug("erroredslug1")).rejects.toThrow(/db down/);

    singleServiceClient({ data: { title: "Back", html: "<main>back</main>" }, error: null });
    const before = countDatabaseReads();
    await expect(fetchPublicReportBySlug("erroredslug1")).resolves.toEqual({
      title: "Back",
      html: "<main>back</main>",
    });
    expect(countDatabaseReads() - before).toBe(1);
  });
});

/**
 * L-13 — a public report link used to be permanent: minted on every generate_report, handed to
 * the user, and revocable by nobody. These specs pin what revoking actually does (null the slug,
 * kill the route) and, above all, that the UPDATE's `user_id` predicate is load-bearing.
 */
describe("revokeReportLink (L-13)", () => {
  const OWNER = "user-1";
  const OTHER = "user-2";
  const REPORT = "11111111-1111-4111-8111-111111111111";
  const HTML = "<main>report</main>";

  function ownedRow(slug: string | null): ReportRow {
    return { id: REPORT, user_id: OWNER, title: "Q3", html: HTML, public_slug: slug };
  }

  it("nulls the caller's own report slug and reports it revoked", async () => {
    reportsServiceClient([ownedRow("revokeslug1")]);

    await expect(revokeReportLink({ userId: OWNER, reportId: REPORT })).resolves.toBe(true);

    expect(reportRows[0]?.public_slug).toBeNull();
    // REVOKE, not delete: the row, its html and its title all survive. Nothing in this feature
    // removes a report, and the UI may not say otherwise.
    expect(reportRows).toHaveLength(1);
    expect(reportRows[0]?.html).toBe(HTML);
    expect(reportRows[0]?.title).toBe("Q3");
  });

  it("kills the public route: the revoked slug resolves to nothing, so /r/<slug> 404s", async () => {
    reportsServiceClient([ownedRow("killslug1")]);
    clientIp = "198.51.100.60";

    // Live before — the page renders this.
    expect(await fetchPublicReportBySlug("killslug1")).toEqual({ title: "Q3", html: HTML });

    await revokeReportLink({ userId: OWNER, reportId: REPORT });

    // Dead immediately after: a NULL public_slug matches no slug param, and hits are never
    // cached, so the very next public request misses and the route calls notFound().
    expect(await fetchPublicReportBySlug("killslug1")).toBeNull();
  });

  it("user A cannot revoke user B's report: not reported revoked, row untouched", async () => {
    reportsServiceClient([{ ...ownedRow("foreignslug1"), user_id: OTHER }]);

    await expect(revokeReportLink({ userId: OWNER, reportId: REPORT })).resolves.toBe(false);

    expect(reportRows[0]?.public_slug).toBe("foreignslug1");
  });

  it("…and B's link KEEPS working afterwards — the user_id filter is the ONLY thing stopping it", async () => {
    // The mutation this spec exists to catch: delete `.eq("user_id", ref.userId)` from
    // revokeReportLink and A's call silently revokes B's link here. RLS cannot help — the
    // service-role client bypasses it — so the predicate in the code IS the tenant boundary.
    reportsServiceClient([{ ...ownedRow("survivingslug1"), user_id: OTHER }]);
    clientIp = "198.51.100.61";

    await revokeReportLink({ userId: OWNER, reportId: REPORT });

    expect(await fetchPublicReportBySlug("survivingslug1")).toEqual({ title: "Q3", html: HTML });
  });

  it("is a no-op that still succeeds when the link was already revoked", async () => {
    reportsServiceClient([ownedRow(null)]);

    await expect(revokeReportLink({ userId: OWNER, reportId: REPORT })).resolves.toBe(true);
    expect(reportRows[0]?.public_slug).toBeNull();
  });

  it("reports nothing revoked for an id that matches no row", async () => {
    reportsServiceClient([ownedRow("otherreport1")]);

    const missing = "22222222-2222-4222-8222-222222222222";
    await expect(revokeReportLink({ userId: OWNER, reportId: missing })).resolves.toBe(false);
    expect(reportRows[0]?.public_slug).toBe("otherreport1");
  });

  it("throws when the update errors, so the UI never claims a revoke that did not happen", async () => {
    reportsServiceClient([ownedRow("erroringslug1")], { message: "db down" });

    await expect(revokeReportLink({ userId: OWNER, reportId: REPORT })).rejects.toThrow(
      /revokeReportLink failed: db down/,
    );
  });
});
