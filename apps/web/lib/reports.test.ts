import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

const serviceClient = vi.fn();
vi.mock("@pseo/db/server", () => ({
  createServiceClient: () => serviceClient(),
}));

import { fetchPublicReportBySlug, listReports } from "./reports";

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
