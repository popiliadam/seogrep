import { describe, expect, it, vi } from "vitest";
import {
  FREE_VENDOR_CALL_ESTIMATE_USD,
  FREE_VENDOR_SPEND_DAILY_USD,
  FreeVendorSpendLimitError,
  MAX_COUNTED_ROWS,
  assertFreeVendorSpendBudget,
  createDbFreeVendorSpendCounter,
  estimateFor,
  freeVendorSpendLimitMessage,
  isFreeVendorSpendLimit,
  utcDayStartIso,
  type FreeVendorSpendCounter,
} from "./free-vendor-calls.ts";
import { PAID_BALANCE_TOOLS } from "./paid-balance.ts";
import type { ServiceClient } from "../db.ts";
import type { ToolName } from "./costs.ts";

/**
 * The per-tenant ceiling on vendor SPEND nobody paid for. Everything here is offline: the counter
 * is a port, and the one spec that exercises the REAL query drives it through a fake PostgREST
 * builder that ACTUALLY APPLIES the filters it is handed.
 *
 * That last part is the point, and it is a lesson this repo has paid for (signed lesson 12): a
 * fake builder that records `.eq(...)` and then returns every row it holds turns a missing tenant
 * filter into a PASSING test. The builder below filters the rows, so deleting `.eq("user_id", …)`
 * from the production query makes another tenant's rows appear in the total and the spec goes red.
 *
 * The estimate TABLE is pinned against the ports' own constants in free-vendor-calls.pin.test.ts,
 * which is a separate file because it must import the money modules and this one must not need to.
 */

/** One credit_ledger row, narrowed to the columns this counter reads. */
interface LedgerRow {
  readonly user_id: string;
  readonly kind: string;
  readonly tool: string | null;
  readonly created_at: string;
}

/**
 * A PostgREST `select` builder over an in-memory row set that really applies `eq`, `in`, `gte`
 * and `limit`. Awaiting it yields `{ data, error }` exactly as supabase-js does.
 *
 * `columns` records what the query PROJECTED, so a spec can assert that a counter over the money
 * ledger never asks for `delta` — the fake would happily serve it, and a projection nobody checks
 * is how the last "green but wrong" reader got in.
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
              resolve: (result: {
                data: LedgerRow[] | null;
                error: { message: string } | null;
              }) => unknown,
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

/** A counter port that always answers `usedUsd`. */
function fixedCounter(usedUsd: number): FreeVendorSpendCounter {
  return { spentTodayUsd: async () => usedUsd };
}

/**
 * How many un-charged calls to `tool` the gate admits before it refuses, DERIVED by driving the
 * real gate against a running total of the real estimate — never by hand arithmetic. This is the
 * function the threshold table below is built from, so a change to the budget, the rule or the
 * estimate table moves the table rather than leaving it a stale comment.
 */
async function freeCallsAdmitted(tool: ToolName): Promise<number> {
  let usedUsd = 0;
  let admitted = 0;
  const counter: FreeVendorSpendCounter = { spentTodayUsd: async () => usedUsd };
  // The refusal writes an operator line by design; it is asserted in its own spec above, and
  // silenced here so a table of fifteen tools does not bury the run in expected stderr.
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    // Bounded well above any real answer; the loop exits on the first refusal.
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        await assertFreeVendorSpendBudget("tenant-a", tool, counter);
      } catch {
        return admitted;
      }
      admitted += 1;
      usedUsd += estimateFor(tool);
    }
    throw new Error(`${tool} was never refused — the gate is not binding`);
  } finally {
    quiet.mockRestore();
  }
}

const VENDOR_TOOL: ToolName = "research_keywords";
const FREE_TOOL: ToolName = "crawl_site";

function ledgerRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
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
    expect(PAID_BALANCE_TOOLS.has(FREE_TOOL)).toBe(false);
    const counter = { spentTodayUsd: vi.fn(async () => 9999) };
    await expect(
      assertFreeVendorSpendBudget("tenant-a", FREE_TOOL, counter),
    ).resolves.toBeUndefined();
    expect(counter.spentTodayUsd).not.toHaveBeenCalled();
  });

  it("consults the counter for every one of the fifteen vendor tools", async () => {
    for (const tool of PAID_BALANCE_TOOLS) {
      const counter = { spentTodayUsd: vi.fn(async () => 0) };
      await assertFreeVendorSpendBudget("tenant-a", tool, counter);
      expect(counter.spentTodayUsd, `${tool} was not rationed`).toHaveBeenCalledOnce();
    }
  });

  it("prices every vendor tool — none falls through to the unknown-tool fallback", () => {
    // A vendor tool with no row would silently be counted at the DEAREST price. That is the safe
    // direction, but it is not the RIGHT price, so the table must cover the set exactly.
    expect(Object.keys(FREE_VENDOR_CALL_ESTIMATE_USD).sort()).toEqual(
      [...PAID_BALANCE_TOOLS].sort(),
    );
  });
});

describe("the budget binds DOLLARS, not calls", () => {
  it("admits a call while the allowance is not yet spent", async () => {
    await expect(
      assertFreeVendorSpendBudget("tenant-a", VENDOR_TOOL, fixedCounter(0.49)),
    ).resolves.toBeUndefined();
  });

  it("refuses AT the budget, not one call later", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      assertFreeVendorSpendBudget(
        "tenant-a",
        VENDOR_TOOL,
        fixedCounter(FREE_VENDOR_SPEND_DAILY_USD),
      ),
    ).rejects.toBeInstanceOf(FreeVendorSpendLimitError);
    expect(error.mock.calls.map((call) => call.join(" ")).join("\n")).toMatch(
      /allowance exhausted: user tenant-a has \$0\.5000/i,
    );
    error.mockRestore();
  });

  it("ALWAYS admits the first call, even on the tool that costs more than the whole budget", async () => {
    // The rule is `used < budget`, not `used + estimate <= budget`. A fresh account must be able
    // to hit one failure on any tool; refusing the dearest tool's very first call — before it had
    // cost anyone anything — would be a broken product rather than a guard.
    expect(FREE_VENDOR_CALL_ESTIMATE_USD.ai_visibility_compare).toBeGreaterThan(
      FREE_VENDOR_SPEND_DAILY_USD,
    );
    await expect(
      assertFreeVendorSpendBudget("tenant-a", "ai_visibility_compare", fixedCounter(0)),
    ).resolves.toBeUndefined();
  });

  it("passes the derived row ceiling to the counter so the read is bounded", async () => {
    const counter = { spentTodayUsd: vi.fn(async () => 0) };
    await assertFreeVendorSpendBudget("tenant-a", VENDOR_TOOL, counter);
    expect(counter.spentTodayUsd).toHaveBeenCalledWith("tenant-a", MAX_COUNTED_ROWS);
  });

  it("reads enough rows that a truncated read is still past the budget", async () => {
    // The ceiling is only sound if MAX_COUNTED_ROWS rows of the CHEAPEST tool already exceed the
    // budget — the query has no ORDER BY, so the bound has to hold for any subset.
    const cheapest = Math.min(...Object.values(FREE_VENDOR_CALL_ESTIMATE_USD));
    expect(MAX_COUNTED_ROWS * cheapest).toBeGreaterThan(FREE_VENDOR_SPEND_DAILY_USD);
  });

  it("changes no price: the budget is vendor dollars, not credits", () => {
    expect(FREE_VENDOR_SPEND_DAILY_USD).toBe(0.5);
    // A sixth of the fleet's $3.00/day cap, which is untouched by this file.
    expect(FREE_VENDOR_SPEND_DAILY_USD * 6).toBe(3);
  });
});

describe("the measured threshold table (done_when 1)", () => {
  // Derived by driving the real gate, never by hand. If the budget, the rule or a tariff moves,
  // these numbers move with it and this spec is what says so.
  it("admits 14 un-charged research_keywords calls and refuses the 15th", async () => {
    expect(await freeCallsAdmitted("research_keywords")).toBe(14);
  });

  it("admits ONE un-charged ai_visibility_compare call and refuses the 2nd", async () => {
    expect(await freeCallsAdmitted("ai_visibility_compare")).toBe(1);
  });

  it("is bounded for every vendor tool — no tool is effectively unlimited", async () => {
    for (const tool of PAID_BALANCE_TOOLS) {
      const admitted = await freeCallsAdmitted(tool);
      expect(admitted, `${tool}`).toBeGreaterThanOrEqual(1);
      expect(admitted, `${tool}`).toBeLessThanOrEqual(15);
    }
  });

  it("bounds the dearest tool far tighter than the cheapest — the point of a $ budget", async () => {
    const dearest = await freeCallsAdmitted("ai_visibility_compare");
    const cheapest = await freeCallsAdmitted("audit_speed");
    expect(dearest).toBeLessThan(cheapest);
  });
});

describe("estimateFor", () => {
  it("uses the tool's own worst-case estimate", () => {
    expect(estimateFor("ai_visibility_compare")).toBe(1.65);
    expect(estimateFor("audit_speed")).toBe(0.0375);
  });

  it("counts an UNKNOWN tool as the dearest call, never as free", () => {
    const dearest = Math.max(...Object.values(FREE_VENDOR_CALL_ESTIMATE_USD));
    expect(estimateFor("some_future_vendor_tool")).toBe(dearest);
    expect(estimateFor(null)).toBe(dearest);
  });
});

describe("fail-closed", () => {
  it("refuses when the allowance cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const counter: FreeVendorSpendCounter = {
      spentTodayUsd: async () => {
        throw new Error("free vendor-spend read failed: connection reset");
      },
    };
    await expect(
      assertFreeVendorSpendBudget("tenant-a", VENDOR_TOOL, counter),
    ).rejects.toBeInstanceOf(FreeVendorSpendLimitError);
    error.mockRestore();
  });

  it("says it is our fault, not the account's, when the counter is unreadable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const counter: FreeVendorSpendCounter = {
      spentTodayUsd: async () => {
        throw new Error("boom");
      },
    };
    const refusal = await assertFreeVendorSpendBudget("tenant-a", VENDOR_TOOL, counter).catch(
      (thrown: unknown) => thrown,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toMatch(/fault on our side/i);
    expect((refusal as Error).message).toMatch(/not charged/i);
    // It must NOT accuse the account of exhausting an allowance it may not have touched.
    expect((refusal as Error).message).not.toMatch(/used up/i);
    error.mockRestore();
  });
});

describe("the refusal a user reads", () => {
  const message = freeVendorSpendLimitMessage(VENDOR_TOOL, FREE_VENDOR_SPEND_DAILY_USD);

  it("names the tool", () => {
    expect(message).toContain(`"${VENDOR_TOOL}"`);
  });

  it("names the allowance as an AMOUNT, not a number of calls", () => {
    expect(message).toContain("$0.50");
    expect(message).toMatch(/allowance of SPEND, not of calls/);
  });

  it("admits that one expensive call can use the whole allowance", () => {
    // The most surprising thing about the rule. Leaving it out would be accurate-but-misleading.
    expect(message).toMatch(/single failed call.*can use\s+it up/i);
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
    expect(isFreeVendorSpendLimit(new FreeVendorSpendLimitError(VENDOR_TOOL, "x"))).toBe(true);
  });

  it("is recognised across a duplicated module instance (name fallback)", () => {
    const impostor = new Error("x");
    impostor.name = "FreeVendorSpendLimitError";
    expect(isFreeVendorSpendLimit(impostor)).toBe(true);
  });

  it("does not swallow an ordinary failure", () => {
    expect(isFreeVendorSpendLimit(new Error("connection reset"))).toBe(false);
    expect(isFreeVendorSpendLimit("FreeVendorSpendLimitError")).toBe(false);
  });
});

describe("utcDayStartIso", () => {
  it("is the UTC midnight of the given instant, not the local one", () => {
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

  it("totals today's un-charged vendor spend at each tool's own estimate", async () => {
    const { client, tables, columns } = createLedgerClient([
      ledgerRow({ created_at: today, tool: "ai_visibility_compare" }),
      ledgerRow({ created_at: today, tool: "audit_speed" }),
    ]);
    await expect(
      createDbFreeVendorSpendCounter(client, CLOCK).spentTodayUsd("tenant-a", MAX_COUNTED_ROWS),
    ).resolves.toBe(1.6875);
    expect(tables).toEqual(["credit_ledger"]);
    // Projection is `tool` alone — a counter over the money ledger has no business reading `delta`.
    expect(columns).toEqual(["tool"]);
  });

  it("does NOT count another tenant's rows (NEVER #4)", async () => {
    const { client } = createLedgerClient([
      ledgerRow({ created_at: today, user_id: "tenant-b", tool: "ai_visibility_compare" }),
      ledgerRow({ created_at: today, user_id: "tenant-b", tool: "ai_visibility_compare" }),
      ledgerRow({ created_at: today, user_id: "tenant-a", tool: "audit_speed" }),
    ]);
    await expect(
      createDbFreeVendorSpendCounter(client, CLOCK).spentTodayUsd("tenant-a", MAX_COUNTED_ROWS),
    ).resolves.toBe(0.0375);
  });

  it("does NOT count calls the account PAID for", async () => {
    // The whole reason a heavy legitimate user never meets this budget. A committed spend is a
    // sale; rationing it would punish exactly the customers the gate exists to protect.
    const { client } = createLedgerClient([
      ledgerRow({ created_at: today, kind: "spend_commit" }),
      ledgerRow({ created_at: today, kind: "spend_commit" }),
      ledgerRow({ created_at: today, kind: "spend_reserve" }),
      ledgerRow({ created_at: today, kind: "purchase" }),
      ledgerRow({ created_at: today, kind: "grant" }),
    ]);
    await expect(
      createDbFreeVendorSpendCounter(client, CLOCK).spentTodayUsd("tenant-a", MAX_COUNTED_ROWS),
    ).resolves.toBe(0);
  });

  it("does NOT count releases from tools that spend no vendor money", async () => {
    const { client } = createLedgerClient([
      ledgerRow({ created_at: today, tool: "generate_report" }),
      ledgerRow({ created_at: today, tool: "audit_schema" }),
      ledgerRow({ created_at: today, tool: null }),
    ]);
    await expect(
      createDbFreeVendorSpendCounter(client, CLOCK).spentTodayUsd("tenant-a", MAX_COUNTED_ROWS),
    ).resolves.toBe(0);
  });

  it("does NOT count yesterday's rows", async () => {
    const { client } = createLedgerClient([
      ledgerRow({ created_at: yesterday, tool: "ai_visibility_compare" }),
      ledgerRow({ created_at: today, tool: "audit_speed" }),
    ]);
    await expect(
      createDbFreeVendorSpendCounter(client, CLOCK).spentTodayUsd("tenant-a", MAX_COUNTED_ROWS),
    ).resolves.toBe(0.0375);
  });

  it("stops reading at the ceiling — and the truncated total still exceeds the budget", async () => {
    const { client } = createLedgerClient(
      Array.from({ length: 200 }, () => ledgerRow({ created_at: today, tool: "audit_speed" })),
    );
    const total = await createDbFreeVendorSpendCounter(client, CLOCK).spentTodayUsd(
      "tenant-a",
      MAX_COUNTED_ROWS,
    );
    expect(total).toBe(Math.round(MAX_COUNTED_ROWS * 0.0375 * 1e6) / 1e6);
    expect(total).toBeGreaterThan(FREE_VENDOR_SPEND_DAILY_USD);
  });

  it("REJECTS on a read error rather than reporting zero", async () => {
    const { client } = createLedgerClient([], { failWith: "connection reset" });
    await expect(
      createDbFreeVendorSpendCounter(client, CLOCK).spentTodayUsd("tenant-a", MAX_COUNTED_ROWS),
    ).rejects.toThrow(/free vendor-spend read failed/i);
  });
});
