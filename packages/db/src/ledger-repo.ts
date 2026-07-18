import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

/**
 * DB-integrated ledger repository. The pure domain (packages/core billing) owns the
 * sign rules and invariants; this layer only persists them. Balance and concurrency
 * safety live entirely in the SQL functions (migration 0005) — the app never reads a
 * balance to decide a reserve. `grantCredits` is the single direct append
 * (grant/purchase); reserve/commit/release delegate to the advisory-locked functions.
 */

// Overlay for the three functions added in migration 0005. The generated types.ts
// (regenerated from cloud once 0005 lands there) will eventually carry these; until
// then this overlay keeps the rpc() calls typed. The one unavoidable cast is fenced
// into `fns()` below.
type LedgerFunctions = {
  reserve_credits: {
    Args: { p_user_id: string; p_amount: number; p_tool: string; p_job_id: string };
    Returns: string;
  };
  commit_reserve: { Args: { p_reserve_id: string }; Returns: undefined };
  release_reserve: { Args: { p_reserve_id: string }; Returns: undefined };
};

type LedgerDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & { Functions: LedgerFunctions };
};

/** The typed client callers pass in — a plain service-role client from server.ts. */
export type LedgerClient = SupabaseClient<Database>;

function fns(client: LedgerClient): SupabaseClient<LedgerDatabase> {
  return client as unknown as SupabaseClient<LedgerDatabase>;
}

export interface GrantCreditsInput {
  readonly userId: string;
  readonly kind: "grant" | "purchase";
  readonly amount: number;
  readonly reason?: string;
  readonly ref?: string;
}

export interface ReserveCreditsInput {
  readonly userId: string;
  readonly amount: number;
  readonly tool: string;
  readonly jobId: string;
}

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (got ${String(value)})`);
  }
}

/**
 * Append a positive grant/purchase entry (single INSERT). Available balance derives
 * from SUM(delta), so this one row is the whole effect. `ref` (external reference,
 * e.g. a Paddle transaction id) is stored in the generic job_id text column.
 */
export async function grantCredits(client: LedgerClient, input: GrantCreditsInput): Promise<void> {
  assertPositiveInt("grant amount", input.amount);
  const { error } = await client.from("credit_ledger").insert({
    user_id: input.userId,
    delta: input.amount,
    kind: input.kind,
    reason: input.reason ?? null,
    job_id: input.ref ?? null,
  });
  if (error) {
    throw new Error(`grantCredits failed: ${error.message}`);
  }
}

/**
 * Reserve `amount` credits via the advisory-locked SQL function and return the new
 * reserveId. Throws on insufficient balance (the DB check) or non-positive amount.
 */
export async function reserveCredits(
  client: LedgerClient,
  input: ReserveCreditsInput,
): Promise<string> {
  assertPositiveInt("reserve amount", input.amount);
  const { data, error } = await fns(client).rpc("reserve_credits", {
    p_user_id: input.userId,
    p_amount: input.amount,
    p_tool: input.tool,
    p_job_id: input.jobId,
  });
  if (error) {
    throw new Error(`reserveCredits failed: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error("reserveCredits: reserve_credits() did not return a reserve_id");
  }
  return data;
}

/** Settle an open reserve (zero-delta commit). Throws if unknown or already settled. */
export async function commitReserve(client: LedgerClient, reserveId: string): Promise<void> {
  const { error } = await fns(client).rpc("commit_reserve", { p_reserve_id: reserveId });
  if (error) {
    throw new Error(`commitReserve failed: ${error.message}`);
  }
}

/** Refund an open reserve (positive release). Throws if unknown or already settled. */
export async function releaseReserve(client: LedgerClient, reserveId: string): Promise<void> {
  const { error } = await fns(client).rpc("release_reserve", { p_reserve_id: reserveId });
  if (error) {
    throw new Error(`releaseReserve failed: ${error.message}`);
  }
}
