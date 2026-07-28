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

import { fetchPublicReportBySlug, listReports } from "./reports";

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
