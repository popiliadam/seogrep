import { getServiceClient, type ServiceClient } from "../db.ts";

/**
 * DataForSEO daily vendor-budget guard (the app side of guardrails/dfs-budget.sh).
 *
 * The constitution caps live DataForSEO spend at $3.00/day (CLAUDE.md NEVER #5). That cap is
 * only real if the counter behind it is ATOMIC, GLOBAL, DURABLE and FAIL-CLOSED, so the counter
 * is a database table (migration 0014), not a file:
 *
 *   ATOMIC      — reserve_dfs_spend checks the day's total AND writes the booking inside ONE
 *                 per-day advisory lock, so the window between "am I under the cap?" and the
 *                 vendor request is closed. Concurrent callers see each other's reservations.
 *   GLOBAL      — one row set for the whole fleet. apps/mcp/fly.toml runs `web` and `worker` as
 *                 separate machines; both now spend against the same counter.
 *   DURABLE     — a restart or redeploy changes nothing; the day's total lives in Postgres.
 *   FAIL-CLOSED — if the counter cannot be read or written, NO call goes out. The previous
 *                 file-backed version counted every read error as $0.00 spent.
 *
 * Flow per vendor operation: reserveSpend() BEFORE the request (the reservation counts against
 * the day at its ESTIMATE from the instant it is written), then settleSpend() after it with the
 * REAL cost the vendor reported. A reservation that is never settled keeps costing its estimate,
 * so a crashed or failed flow errs toward refusing the next call.
 *
 * This is VENDOR spend, not user credits: it never touches credit_ledger (constitution NEVER #2).
 * There is NO live call in test or CI (NEVER #5) — the ledger is a port, and specs inject a fake
 * or drive the real RPCs against a local stack (budget.db.test.ts).
 */

/**
 * Sanctioned daily cap for live DataForSEO spend (USD). CLAUDE.md NEVER #5.
 * The DB holds the authoritative copy (public.dfs_daily_budget_usd); budget.db.test.ts pins the
 * two together so they cannot drift.
 */
export const DAILY_BUDGET_USD = 3.0;

/** An open booking against today's budget: written BEFORE the vendor request, settled after it. */
export interface SpendReservation {
  readonly id: string;
  readonly endpoint: string;
  readonly estimatedUsd: number;
}

/**
 * The fleet-global spend counter, as a port. The production implementation is the migration-0014
 * RPC trio; specs inject a fake so no test needs a database or a network.
 */
export interface SpendLedger {
  /** Book `estimatedUsd` against today. Resolves to the reservation id, or REJECTS at the cap. */
  reserve(estimatedUsd: number, endpoint: string): Promise<string>;
  /** Reconcile an open reservation with the real cost. Rejects if unknown or already settled. */
  settle(reservationId: string, actualUsd: number, rowCount: number): Promise<void>;
  /** Today's committed spend (USD): open reservations at estimate, settled ones at real cost. */
  todayUsd(): Promise<number>;
}

/** The DB error text reserve_dfs_spend raises at the cap — the one refusal that is not a fault. */
const OVER_BUDGET_MARKER = "daily budget exceeded";

/** True when a ledger rejection is the cap itself rather than an infrastructure failure. */
function isOverBudget(message: string): boolean {
  return message.toLowerCase().includes(OVER_BUDGET_MARKER);
}

/** A PostgREST error surface, narrowed to the field this module reports. */
function rpcErrorMessage(error: { message?: string } | null): string | null {
  return error ? (error.message ?? "unknown RPC error") : null;
}

/**
 * The production ledger: the migration-0014 RPCs over the service-role client. Every method
 * REJECTS on any RPC error — translating a failure into "nothing spent" is the fail-open hole
 * this replaces, so the error is passed up and the caller refuses the vendor request.
 */
export function createDbSpendLedger(client?: ServiceClient): SpendLedger {
  const db = (): ServiceClient => client ?? getServiceClient();
  return {
    async reserve(estimatedUsd, endpoint) {
      const { data, error } = await db().rpc("reserve_dfs_spend", {
        p_estimated_usd: estimatedUsd,
        p_endpoint: endpoint,
      });
      const message = rpcErrorMessage(error);
      if (message !== null) throw new Error(message);
      if (typeof data !== "string" || data === "") {
        throw new Error("reserve_dfs_spend returned no reservation id");
      }
      return data;
    },
    async settle(reservationId, actualUsd, rowCount) {
      const { error } = await db().rpc("settle_dfs_spend", {
        p_reservation_id: reservationId,
        p_actual_usd: actualUsd,
        p_row_count: rowCount,
      });
      const message = rpcErrorMessage(error);
      if (message !== null) throw new Error(message);
    },
    async todayUsd() {
      const { data, error } = await db().rpc("dfs_spend_today_usd");
      const message = rpcErrorMessage(error);
      if (message !== null) throw new Error(message);
      const total = Number(data);
      if (!Number.isFinite(total)) {
        throw new Error(`dfs_spend_today_usd returned a non-numeric total: ${String(data)}`);
      }
      return total;
    },
  };
}

/**
 * Fail-closed pre-call gate AND booking, in one step. Called BEFORE every live DataForSEO
 * request. Two ways to say no, both of which refuse the call:
 *   - at the cap        — a loud WAKE-THE-HUMAN line (contract wake class: money / outside world)
 *   - ledger unreadable — no call goes out; an uncountable spend is treated as unaffordable
 * Returns the reservation the caller must settle once the real cost is known.
 */
export async function reserveSpend(
  estimatedCostUsd: number,
  endpoint: string,
  ledger: SpendLedger,
): Promise<SpendReservation> {
  let id: string;
  try {
    id = await ledger.reserve(estimatedCostUsd, endpoint);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isOverBudget(detail)) {
      console.error(
        `WAKE THE HUMAN — DataForSEO daily budget guard tripped: an estimated ` +
          `$${estimatedCostUsd.toFixed(4)} call to ${endpoint} would exceed the ` +
          `$${DAILY_BUDGET_USD.toFixed(2)} cap. Live call refused ` +
          `(contract wake class: money / outside world). Ledger said: ${detail}`,
      );
      throw new Error(detail);
    }
    console.error(
      `WAKE THE HUMAN — DataForSEO budget ledger is unreachable, so today's spend cannot be ` +
        `counted. Refusing the live call to ${endpoint} rather than spending blind ` +
        `(contract wake class: money / outside world). Ledger said: ${detail}`,
    );
    throw new Error(
      `DataForSEO budget ledger unavailable: today's spend could not be counted, so the live ` +
        `call was refused (fail-closed). Cause: ${detail}`,
    );
  }
  return { id, endpoint, estimatedUsd: estimatedCostUsd };
}

/**
 * Reconcile a reservation with the REAL cost the vendor reported, AFTER the request.
 *
 * Deliberately does NOT throw: by the time this runs the money is already spent and the caller
 * is holding paid data, so failing here would throw away a call the business has been billed for
 * without making the budget any safer. An unsettled reservation keeps counting at its estimate,
 * which is the conservative direction — the honest residual limit is that a call whose REAL cost
 * came in ABOVE its estimate is under-counted until the day rolls over, so the failure is logged
 * as a wake line rather than swallowed.
 */
export async function settleSpend(
  reservation: SpendReservation,
  actualCostUsd: number,
  rowCount: number,
  ledger: SpendLedger,
): Promise<void> {
  try {
    await ledger.settle(reservation.id, actualCostUsd, rowCount);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `WAKE THE HUMAN — DataForSEO spend reservation ${reservation.id} (${reservation.endpoint}) ` +
        `could not be settled at its real cost $${actualCostUsd.toFixed(4)}; it stays OPEN and ` +
        `keeps costing today's budget its $${reservation.estimatedUsd.toFixed(4)} estimate. ` +
        `Spend above that estimate is UNDER-COUNTED until the UTC day rolls over ` +
        `(contract wake class: money / outside world). Ledger said: ${detail}`,
    );
  }
}

/** Today's committed DataForSEO spend (USD). Throws if the counter cannot be read. */
export async function todaySpendUsd(ledger: SpendLedger): Promise<number> {
  return ledger.todayUsd();
}
