/**
 * A RECORDING stand-in for the service-role client, for specs about WHAT THE CREDIT GUARD BUILT.
 *
 * It is the fake `audit-speed-charge.pin.test.ts` proved the shape of on 2026-09-02, lifted out of
 * that file because the same claim has to be made for every `charge:"handler"` tool rather than for
 * one of them. Its discipline is test/fake-query.ts's (signed lesson 12): it RECORDS the RPC calls
 * and applies none of them, so a spec asserts on the ARGUMENTS the guard assembled — never on rows
 * the fake handed back, which would be a spec about the fake.
 *
 * `from()` answers the two PRE-reserve ledger READS withCredits makes before it ever reserves:
 *   - `select("id")` — the paid-balance gate (credits/paid-balance.ts). A row means "this account
 *     has paid", which the gated DataForSEO tools need or the reserve is never reached at all.
 *   - `select("tool")` — the free-vendor-spend counter (credits/free-vendor-calls.ts). Empty means
 *     nothing has been spent un-charged today, so the allowance gate lets the call through.
 *
 * WHAT IT DOES NOT CLAIM: that migration 0005 behaves correctly against real rows. That is the
 * `*.db.test.ts` lane's job and it keeps it.
 */

/** One recorded RPC, with the arguments the caller assembled for it. */
export interface RecordedRpc {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface LedgerRecorder {
  /** Hand this to code that expects `getServiceClient()`'s return. */
  readonly client: unknown;
  /** Every RPC issued, in call order. */
  readonly rpcs: readonly RecordedRpc[];
  /** The single `reserve_credits` call, or undefined when the guard never reserved. */
  reserve(): RecordedRpc | undefined;
}

/** The reserve id the fake hands back; arbitrary, and nothing asserts on it. */
const RESERVE_ID = "b6b0f0de-1e1e-4a2a-9c33-0a1b2c3d4e5f";

export function createLedgerRecorder(): LedgerRecorder {
  const rpcs: RecordedRpc[] = [];
  const chain = (projection: string): unknown => {
    const link: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "gt", "gte", "limit", "order"]) {
      link[method] = (...args: readonly unknown[]): unknown =>
        method === "select" ? chain(String(args[0] ?? "")) : link;
    }
    link.then = <A>(onFulfilled?: (value: unknown) => A): PromiseLike<A> =>
      Promise.resolve({
        data: projection === "id" ? [{ id: 1 }] : [],
        error: null,
        count: null,
      }).then(onFulfilled);
    return link;
  };
  return {
    client: {
      from: () => chain(""),
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        return Promise.resolve({
          data: name === "reserve_credits" ? RESERVE_ID : null,
          error: null,
        });
      },
    },
    rpcs,
    reserve: () => rpcs.find((rpc) => rpc.name === "reserve_credits"),
  };
}

/**
 * THE ONE RECORDER a spec file's `vi.mock("../db.ts")` factory reads.
 *
 * A `vi.mock` factory is hoisted above every import, so it cannot close over a spec file's own
 * `let`; it has to reach a live holder instead. Keeping the holder here means each spec file's
 * mock is one line (`getServiceClient: () => currentRecorder().client`) and the swap-per-call
 * belongs to the shared runner rather than to every file that uses it.
 */
let current = createLedgerRecorder();

export function currentRecorder(): LedgerRecorder {
  return current;
}

/** Start a fresh recording; returns the recorder the next call will write into. */
export function resetRecorder(): LedgerRecorder {
  current = createLedgerRecorder();
  return current;
}
