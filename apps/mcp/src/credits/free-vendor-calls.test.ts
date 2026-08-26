import { describe, expect, it, vi } from "vitest";
import {
  FREE_VENDOR_CALL_DAILY_LIMIT,
  FreeVendorCallLimitError,
  assertFreeVendorCallBudget,
  createDbFreeVendorCallCounter,
  freeVendorCallLimitMessage,
  isFreeVendorCallLimit,
  utcDayStartIso,
  type FreeVendorCallCounter,
} from "./free-vendor-calls.ts";
import { PAID_BALANCE_TOOLS } from "./paid-balance.ts";
import type { ServiceClient } from "../db.ts";
import type { ToolName } from "./costs.ts";

/**
 * The per-tenant ceiling on vendor calls nobody paid for. Everything here is offline: the counter
 * is a port, and the one spec that exercises the REAL query drives it through a fake PostgREST
 * builder that ACTUALLY APPLIES the filters it is handed.
 *
 * That last part is the point, and it is a lesson this repo has paid for (signed lesson 12): a
 * fake builder that records `.eq(...)` and then returns every row it holds turns a missing tenant
 * filter into a PASSING test. The builder below filters the rows, so deleting `.eq("user_id", …)`
 * from the production query makes another tenant's rows appear in the count and the spec goes red.
 */

/** One credit_ledger row, narrowed to the columns this counter reads. */
interface LedgerRow {
  readonly id: number;
  readonly user_id: string;
  readonly kind: string;
  readonly tool: string | null;
  readonly created_at: string;
}

/**
 * A PostgREST `select` builder over an in-memory row set that really applies `eq`, `in`, `gte`
 * and `limit`. Awaiting it yields `{ data, error }` exactly as supabase-js does.
 *
 * `seenColumns` records which columns the query PROJECTED, so a spec can assert that a counter
 * over the money ledger never asks for `delta` — the fake would happily serve it, and a
 * projection nobody checks is how the last "green but wrong" reader got in.
 */
function createLedgerClient(
  rows: readonly LedgerRow[],
  options: { readonly failWith?: string } = {},
): { client: ServiceClient; tables: string[]; columns: string[] } {
  const tables: string[] = [];
  const columns: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      return {
        select(projection: string) {
          columns.push(projection);
          let current: LedgerRow[] = [...rows];
          const builder = {
            eq(column: keyof LedgerRow, value: unknown) {
              current = current.filter((row) => row[column] === value);
              return builder;
            },
            in(column: keyof LedgerRow, values: readonly unknown[]) {
              current = current.filter((row) => values.includes(row[column]));
              return builder;
            },
            gte(column: keyof LedgerRow, value: string) {
              current = current.filter((row) => String(row[column]) >= value);
              return builder;
            },
            limit(count: number) {
              current = current.slice(0, count);
              return builder;
            },
            then(
              resolve: (result: { data: LedgerRow[] | null; error: { message: string } | null }) => unknown,
            ) {
              return Promise.resolve(
                options.failWith
                  ? { data: null, error: { message: options.failWith } }
                  : { data: current, error: null },
              ).then(resolve);
            },
          };
          return builder;
        },
      };
    },
  } as unknown as ServiceClient;
  return { client, tables, columns };
}

/** A counter port that always answers `used`. */
function fixedCounter(used: number): FreeVendorCallCounter {
  return { countToday: async () => used };
}

/** A vendor tool and a non-vendor tool, taken from the gate's own source of truth. */
const VENDOR_TOOL: ToolName = "research_keywords";
const FREE_TOOL: ToolName = "crawl_site";

function ledgerRow(overrides: Partial<LedgerRow> & { id: number }): LedgerRow {
  return {
    user_id: "tenant-a",
    kind: "spend_release",
    tool: VENDOR_TOOL,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("the gate's scope", () => {
  it("rations the vendor tools and nothing else", async () => {
    // A non-vendor tool never consults the counter at all: crawls, stored-data audits, reports
    // and Search Console tools spend our own CPU, so there is no vendor money to ration.
    expect(PAID_BALANCE_TOOLS.has(FREE_TOOL)).toBe(false);
    const counter = { countToday: vi.fn(async () => 9999) };
    await expect(
      assertFreeVendorCallBudget("tenant-a", FREE_TOOL, counter),
    ).resolves.toBeUndefined();
    expect(counter.countToday).not.toHaveBeenCalled();
  });

  it("consults the counter for every one of the fifteen vendor tools", async () => {
    for (const tool of PAID_BALANCE_TOOLS) {
      const counter = { countToday: vi.fn(async () => 0) };
      await assertFreeVendorCallBudget("tenant-a", tool, counter);
      expect(counter.countToday, `${tool} was not rationed`).toHaveBeenCalledOnce();
    }
  });
});

describe("the limit itself", () => {
  it("lets a call through while the allowance is not yet spent", async () => {
    await expect(
      assertFreeVendorCallBudget("tenant-a", VENDOR_TOOL, fixedCounter(FREE_VENDOR_CALL_DAILY_LIMIT - 1)),
    ).resolves.toBeUndefined();
  });

  it("refuses AT the limit, not one call later", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      assertFreeVendorCallBudget("tenant-a", VENDOR_TOOL, fixedCounter(FREE_VENDOR_CALL_DAILY_LIMIT)),
    ).rejects.toBeInstanceOf(FreeVendorCallLimitError);
    // The operator gets a line naming the account, the count and the tool — an exhausted
    // allowance is exactly what a vendor-budget complaint has to be correlated against.
    expect(error.mock.calls.map((call) => call.join(" ")).join("\n")).toMatch(
      /allowance exhausted: user tenant-a has 20/i,
    );
    error.mockRestore();
  });

  it("passes the ceiling to the counter so the read is bounded", async () => {
    const counter = { countToday: vi.fn(async () => 0) };
    await assertFreeVendorCallBudget("tenant-a", VENDOR_TOOL, counter);
    expect(counter.countToday).toHaveBeenCalledWith("tenant-a", FREE_VENDOR_CALL_DAILY_LIMIT);
  });

  it("changes no price: the limit is a call count, not a credit or dollar figure", () => {
    expect(FREE_VENDOR_CALL_DAILY_LIMIT).toBe(20);
  });
});

describe("fail-closed", () => {
  it("refuses when the allowance cannot be counted", async () => {
    // An allowance that cannot be counted is treated as spent — the same posture dfs/budget.ts
    // takes toward an unreadable spend counter. Answering "0 so far" on a database blip would
    // make this a gate in name only.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const counter: FreeVendorCallCounter = {
      countToday: async () => {
        throw new Error("free vendor-call count failed: connection reset");
      },
    };
    await expect(
      assertFreeVendorCallBudget("tenant-a", VENDOR_TOOL, counter),
    ).rejects.toBeInstanceOf(FreeVendorCallLimitError);
    error.mockRestore();
  });

  it("says it is our fault, not the account's, when the counter is unreadable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const counter: FreeVendorCallCounter = {
      countToday: async () => {
        throw new Error("boom");
      },
    };
    const refusal = await assertFreeVendorCallBudget("tenant-a", VENDOR_TOOL, counter).catch(
      (thrown: unknown) => thrown,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toMatch(/fault on our side/i);
    expect((refusal as Error).message).toMatch(/not charged/i);
    // It must NOT accuse the account of exhausting an allowance it may not have touched.
    expect((refusal as Error).message).not.toMatch(/used all/i);
    error.mockRestore();
  });
});

describe("the refusal a user reads", () => {
  const message = freeVendorCallLimitMessage(VENDOR_TOOL, FREE_VENDOR_CALL_DAILY_LIMIT);

  it("names the tool", () => {
    expect(message).toContain(`"${VENDOR_TOOL}"`);
  });

  it("says when it clears", () => {
    expect(message).toMatch(/00:00 utc/i);
  });

  it("says nothing was charged", () => {
    expect(message).toMatch(/not charged|neither is this refusal/i);
  });

  it("says the rest of the account still works", () => {
    expect(message).toMatch(/unaffected/i);
  });

  it("is English, the UI-copy language for this product", () => {
    // A Turkish word slipping in from the work order is a measured failure mode here (signed
    // lesson 4), so the copy is pinned against the characters that would carry one.
    expect(message).not.toMatch(/[çğışöüÇĞİŞÖÜ]/);
  });
});

describe("the typed error", () => {
  it("is recognised by instance", () => {
    expect(isFreeVendorCallLimit(new FreeVendorCallLimitError(VENDOR_TOOL, "x"))).toBe(true);
  });

  it("is recognised across a duplicated module instance (name fallback)", () => {
    const impostor = new Error("x");
    impostor.name = "FreeVendorCallLimitError";
    expect(isFreeVendorCallLimit(impostor)).toBe(true);
  });

  it("does not swallow an ordinary failure", () => {
    expect(isFreeVendorCallLimit(new Error("connection reset"))).toBe(false);
    expect(isFreeVendorCallLimit("FreeVendorCallLimitError")).toBe(false);
  });
});

describe("utcDayStartIso", () => {
  it("is the UTC midnight of the given instant, not the local one", () => {
    // 01:30 UTC on the 26th. A local-time implementation west of Greenwich would answer the 25th.
    expect(utcDayStartIso(new Date("2026-08-26T01:30:00.000Z"))).toBe("2026-08-26T00:00:00.000Z");
  });

  it("does not roll over early late in the UTC day", () => {
    expect(utcDayStartIso(new Date("2026-08-26T23:59:59.999Z"))).toBe("2026-08-26T00:00:00.000Z");
  });
});

describe("the real ledger query", () => {
  const today = "2026-08-26T09:00:00.000Z";
  const yesterday = "2026-08-25T09:00:00.000Z";
  // Pinned clock: the day boundary these specs assert must hold on every date the suite runs,
  // not only on the day it was written.
  const CLOCK = (): Date => new Date(today);

  it("counts this tenant's un-charged vendor calls from today", async () => {
    const { client, tables, columns } = createLedgerClient([
      ledgerRow({ id: 1, created_at: today }),
      ledgerRow({ id: 2, created_at: today }),
    ]);
    await expect(createDbFreeVendorCallCounter(client, CLOCK).countToday("tenant-a", 20)).resolves.toBe(2);
    expect(tables).toEqual(["credit_ledger"]);
    // Projection is the id alone — a counter over the money ledger has no business reading `delta`.
    expect(columns).toEqual(["id"]);
  });

  it("does NOT count another tenant's rows (NEVER #4)", async () => {
    const { client } = createLedgerClient([
      ledgerRow({ id: 1, created_at: today, user_id: "tenant-b" }),
      ledgerRow({ id: 2, created_at: today, user_id: "tenant-b" }),
      ledgerRow({ id: 3, created_at: today, user_id: "tenant-a" }),
    ]);
    await expect(createDbFreeVendorCallCounter(client, CLOCK).countToday("tenant-a", 20)).resolves.toBe(1);
  });

  it("does NOT count calls the account PAID for", async () => {
    // The whole reason a heavy legitimate user never meets this limit. A committed spend is a
    // sale; rationing it would punish exactly the customers the gate exists to protect.
    const { client } = createLedgerClient([
      ledgerRow({ id: 1, created_at: today, kind: "spend_commit" }),
      ledgerRow({ id: 2, created_at: today, kind: "spend_commit" }),
      ledgerRow({ id: 3, created_at: today, kind: "spend_reserve" }),
      ledgerRow({ id: 4, created_at: today, kind: "purchase" }),
      ledgerRow({ id: 5, created_at: today, kind: "grant" }),
    ]);
    await expect(createDbFreeVendorCallCounter(client, CLOCK).countToday("tenant-a", 20)).resolves.toBe(0);
  });

  it("does NOT count releases from tools that spend no vendor money", async () => {
    const { client } = createLedgerClient([
      ledgerRow({ id: 1, created_at: today, tool: "generate_report" }),
      ledgerRow({ id: 2, created_at: today, tool: "audit_schema" }),
      ledgerRow({ id: 3, created_at: today, tool: null }),
    ]);
    await expect(createDbFreeVendorCallCounter(client, CLOCK).countToday("tenant-a", 20)).resolves.toBe(0);
  });

  it("does NOT count yesterday's rows", async () => {
    const { client } = createLedgerClient([
      ledgerRow({ id: 1, created_at: yesterday }),
      ledgerRow({ id: 2, created_at: today }),
    ]);
    await expect(createDbFreeVendorCallCounter(client, CLOCK).countToday("tenant-a", 20)).resolves.toBe(1);
  });

  it("stops counting at the ceiling", async () => {
    const { client } = createLedgerClient(
      Array.from({ length: 50 }, (_, index) => ledgerRow({ id: index, created_at: today })),
    );
    await expect(createDbFreeVendorCallCounter(client, CLOCK).countToday("tenant-a", 20)).resolves.toBe(20);
  });

  it("REJECTS on a read error rather than reporting zero", async () => {
    const { client } = createLedgerClient([], { failWith: "connection reset" });
    await expect(
      createDbFreeVendorCallCounter(client, CLOCK).countToday("tenant-a", 20),
    ).rejects.toThrow(/free vendor-call count failed/i);
  });
});
