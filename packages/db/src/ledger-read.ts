import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

/**
 * READ path for the credit ledger — the deliberate counterpart to ledger-repo.ts.
 * Where ledger-repo writes through the SERVICE-ROLE client (RLS bypass), everything
 * here is read through the CALLER's authenticated client, so RLS is the real scope:
 *   - `credit_balances` is a security_invoker view, so the caller's own
 *     `credit_ledger_select_own` policy applies to the aggregate;
 *   - `credit_ledger` reads are owner-scoped by the same policy.
 * Keeping reads in their own module (and export subpath) means user-facing RSC pages
 * never import the service-role-flavoured write module.
 */

/** The caller's authenticated client (anon key + user JWT). Same shape as any client. */
export type ReadClient = SupabaseClient<Database>;

/** A ledger row as the dashboard renders it (camelCased, presentation-relevant fields). */
export interface LedgerEntry {
  readonly id: number;
  readonly createdAt: string;
  readonly delta: number;
  readonly kind: string;
  readonly reason: string | null;
  readonly tool: string | null;
}

/** 1-based paging request. Both values are clamped to a positive integer. */
export interface ListLedgerParams {
  readonly page: number;
  readonly pageSize: number;
}

/** One page of ledger entries plus the RLS-scoped total row count. */
export interface LedgerPage {
  readonly entries: readonly LedgerEntry[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

type EntryColumns = Pick<
  Database["public"]["Tables"]["credit_ledger"]["Row"],
  "id" | "created_at" | "delta" | "kind" | "reason" | "tool"
>;

const ENTRY_COLUMNS = "id, created_at, delta, kind, reason, tool";

function toEntry(row: EntryColumns): LedgerEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    delta: row.delta,
    kind: row.kind,
    reason: row.reason,
    tool: row.tool,
  };
}

/** Clamp to a positive integer; anything else (0, negative, NaN, fractional) -> fallback. */
function clampPositiveInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

/**
 * Read the caller's derived available balance from the credit_balances view; 0 when
 * the user has no ledger rows. MUST be called with the caller's authenticated client:
 * the security_invoker view leans on the caller's RLS, and the explicit user_id filter
 * is defence in depth.
 */
export async function getBalance(client: ReadClient, userId: string): Promise<number> {
  const { data, error } = await client
    .from("credit_balances")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`getBalance failed: ${error.message}`);
  }
  return data?.balance ?? 0;
}

/**
 * List one page of the caller's ledger, newest first with a deterministic secondary
 * sort on id (so rows sharing a created_at keep a stable order across pages). `total`
 * is the RLS-scoped exact count. MUST be called with the caller's authenticated client.
 */
export async function listLedgerEntries(
  client: ReadClient,
  userId: string,
  params: ListLedgerParams,
): Promise<LedgerPage> {
  const page = clampPositiveInt(params.page, 1);
  const pageSize = clampPositiveInt(params.pageSize, 25);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await client
    .from("credit_ledger")
    .select(ENTRY_COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (error) {
    throw new Error(`listLedgerEntries failed: ${error.message}`);
  }

  return {
    entries: (data ?? []).map(toEntry),
    total: count ?? 0,
    page,
    pageSize,
  };
}
