import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { KeyRecord } from "./auth.ts";
import { loadEnv } from "./env.ts";

/**
 * Database adapters for the MCP gateway (infrastructure layer). This module is the
 * SINGLE owner of the service-role Supabase client, its one hand-written schema
 * slice, and the tenant-scoped accessors every Phase-3 slice reuses. Both entry
 * points build the SAME SupabaseClient<Database>:
 *
 *   - createServiceClient() — eager factory, wired once at the composition root
 *     (server.ts). Reads the two client vars directly and throws its own message.
 *   - getServiceClient()    — lazy singleton, used by the queue + credit call sites.
 *     Lazy so importing a module never requires env; validates via loadEnv.
 *
 * There is no second client and no second schema anywhere in this app — the queue
 * module used to carry a parallel client + schema slice; that was consolidated here
 * (referee note: two DB slices -> one), and credits/guard.ts now takes its client
 * from here rather than reaching up through the queue module (reverse layering).
 *
 * The service-role key bypasses RLS and must never reach the browser: createServiceClient
 * fails fast if it is ever evaluated in a browser bundle. Tenant safety on this
 * RLS-bypassing client comes from the explicit user_id filter (forUser / the balance
 * read below), never from RLS (constitution NEVER #4).
 */

/** JSON value as stored in jsonb columns (jobs.result). */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/**
 * A jobs row. Declared as a `type`, not an `interface`: the supabase-js GenericSchema
 * constraint (`Row extends Record<string, unknown>`) needs the implicit index signature
 * a type alias has and a named interface lacks — a failing constraint silently collapses
 * the whole client schema to `never` (hard-won lesson carried over from the queue module).
 */
export type JobRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  tool: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: Json | null;
  reserve_id: string | null;
};

/**
 * The one hand-written schema slice the MCP service pins. The full generated types
 * live in @pseo/db (intentionally NOT a dependency here — the gateway needs only this
 * narrow surface). Every table added here MUST carry a `user_id` column so forUser can
 * scope it (constitution NEVER #4). The structural shape (__InternalSupabase, the
 * `[_ in never]: never` empties) mirrors the generated @pseo/db types so the supabase-js
 * generics resolve; the whole schema is a `type` for the same never-collapse reason as
 * JobRow above.
 */
export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      // Hashed, revocable personal API keys. last_used_at (migration 0009) is modelled
      // here; the committed @pseo/db types.ts predates that column.
      api_keys: {
        Row: {
          id: string;
          user_id: string;
          key_hash: string;
          key_prefix: string;
          created_at: string;
          revoked_at: string | null;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          key_hash: string;
          key_prefix: string;
          created_at?: string;
          revoked_at?: string | null;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          key_hash?: string;
          key_prefix?: string;
          created_at?: string;
          revoked_at?: string | null;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      // A tracked domain owned by a user (migration 0001). A (user_id, domain) unique
      // constraint (migration 0010) backs setup_project's race-safe ON CONFLICT upsert.
      projects: {
        Row: {
          id: string;
          user_id: string;
          domain: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          domain: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          domain?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      jobs: {
        Row: JobRow;
        Insert: {
          user_id: string;
          project_id?: string | null;
          tool: string;
          status?: JobStatus;
        };
        Update: {
          status?: JobStatus;
          started_at?: string | null;
          finished_at?: string | null;
          error?: string | null;
          result?: Json | null;
          reserve_id?: string | null;
        };
        Relationships: [];
      };
      // Generated, shareable report records (migrations 0001 + 0009). generate_report
      // (T12) INSERTs the rendered HTML body + a human title, keyed to an unguessable
      // public_slug the public /r/[slug] page reads back. The committed @pseo/db generated
      // types still predate the 0009 title/html/tool columns, so — as with api_keys /
      // gsc_connections above — the full column set is modelled here.
      reports: {
        Row: {
          id: string;
          user_id: string;
          job_id: string | null;
          public_slug: string | null;
          title: string | null;
          html: string | null;
          tool: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          job_id?: string | null;
          public_slug?: string | null;
          title?: string | null;
          html?: string | null;
          tool?: string | null;
          created_at?: string;
        };
        Update: {
          public_slug?: string | null;
          title?: string | null;
          html?: string | null;
          tool?: string | null;
        };
        Relationships: [];
      };
      // Per-project Google Search Console link (migrations 0003 + 0009). Stores the
      // AES-256-GCM-sealed refresh token (bytea, read back as a \x-hex string) and the
      // resolved property. The web OAuth callback writes it; pull_gsc_data reads it back
      // (tenant-scoped by user_id — constitution NEVER #4). gsc_property is migration 0009,
      // which the committed @pseo/db generated types still omit, so it is modeled here.
      gsc_connections: {
        Row: {
          id: string;
          user_id: string;
          project_id: string;
          encrypted_refresh_token: string | null;
          gsc_property: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id: string;
          encrypted_refresh_token?: string | null;
          gsc_property?: string | null;
          created_at?: string;
        };
        Update: {
          encrypted_refresh_token?: string | null;
          gsc_property?: string | null;
        };
        Relationships: [];
      };
      // Append-only money ledger. Update is `never` so the type system forbids the
      // mutation the DB armor (migration 0002) also rejects (constitution NEVER #2).
      credit_ledger: {
        Row: {
          id: number;
          user_id: string;
          delta: number;
          kind: string;
          reason: string | null;
          tool: string | null;
          job_id: string | null;
          reserve_id: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          delta: number;
          kind: string;
          reason?: string | null;
          tool?: string | null;
          job_id?: string | null;
          reserve_id?: string | null;
        };
        Update: {
          [_ in never]: never;
        };
        Relationships: [];
      };
    };
    Views: {
      // Per-user derived balance = COALESCE(SUM(delta), 0) (migration 0002, security_invoker).
      // The SUM runs server-side and returns ONE row per user, so reading it (filtered to the
      // tenant) is immune to PostgREST's max_rows page cap — unlike an app-side Σ over raw
      // delta rows, which silently truncates a 1000+ row ledger and under-reports the balance.
      credit_balances: {
        Row: {
          user_id: string | null;
          balance: number | null;
        };
        Relationships: [];
      };
    };
    // The migration-0005 ledger RPCs — the ONLY ledger write path this app uses
    // (reserve/commit/release under a per-user advisory lock). No direct ledger writes.
    Functions: {
      reserve_credits: {
        Args: { p_user_id: string; p_amount: number; p_tool: string; p_job_id: string };
        Returns: string;
      };
      commit_reserve: { Args: { p_reserve_id: string }; Returns: undefined };
      release_reserve: { Args: { p_reserve_id: string }; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type ServiceClient = SupabaseClient<Database>;

/** A jobs UPDATE patch — the queue module settles status / reserve_id through this. */
export type JobUpdate = Database["public"]["Tables"]["jobs"]["Update"];

/** Table names that carry a tenant `user_id` column (scopable by forUser). */
export type TenantTable = keyof Database["public"]["Tables"];

/**
 * Service-role Supabase client factory (RLS bypass), for SERVER-SIDE use only.
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (the real prod names, matching
 * apps/mcp env.ts and guardrails/verify-db.sh); never hardcoded. Throws a clear
 * error if either is missing (the 2026-07-18 lesson: a missing env must fail loud,
 * not silently degrade). Session persistence and token refresh are off — this is a
 * stateless server client. Eager (no cache): the composition root calls it exactly once.
 */
export function createServiceClient(): ServiceClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "createServiceClient() must never run in the browser: it uses the service_role key (RLS bypass)",
    );
  }
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "createServiceClient() requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let cachedClient: ServiceClient | null = null;

/**
 * Lazy service-role singleton (RLS bypass — server-side only). Lazy so importing this
 * module never requires env; the first DB touch fails fast via loadEnv when the real
 * prod-named variables are missing. This is the accessor the queue (boss.ts) and credit
 * guard call sites use; createServiceClient is the eager composition-root factory. Both
 * yield the same SupabaseClient<Database>.
 */
export function getServiceClient(): ServiceClient {
  if (!cachedClient) {
    const env = loadEnv();
    cachedClient = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

/**
 * Look up an ACTIVE key by its sha256 hash: key_hash = ? AND revoked_at IS NULL.
 * This is the one deliberately NON-tenant-scoped query — it is how the gateway
 * DISCOVERS the tenant. Returns only { keyId, userId }; a revoked or unknown key
 * both resolve to null (the filter excludes revoked rows). key_hash is UNIQUE, so
 * maybeSingle matches at most one row.
 */
export async function findActiveKeyByHash(
  client: ServiceClient,
  keyHash: string,
): Promise<KeyRecord | null> {
  const { data, error } = await client
    .from("api_keys")
    .select("id, user_id")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`api_keys lookup failed: ${error.message}`);
  }
  return data ? { keyId: data.id, userId: data.user_id } : null;
}

/**
 * Stamp last_used_at for a key (service-role write — the authenticated role has no
 * UPDATE grant). Called fire-and-forget by the authenticator, so it throws on error
 * (the caller decides to swallow + log); it never silently succeeds.
 */
export async function touchLastUsed(
  client: ServiceClient,
  keyId: string,
  at: Date,
): Promise<void> {
  const { error } = await client
    .from("api_keys")
    .update({ last_used_at: at.toISOString() })
    .eq("id", keyId);
  if (error) {
    throw new Error(`last_used_at update failed: ${error.message}`);
  }
}

/**
 * A tenant-scoped view over the service client. Every read is forced through
 * .eq("user_id", userId), so a downstream caller cannot read across tenants even
 * though the underlying client is service-role (RLS-bypassing) — the explicit
 * user_id filter is the guard (constitution NEVER #4). This is the pattern Phase-3
 * tool reads (e.g. list_projects) consume; the raw client is not re-exposed.
 */
export function forUser(client: ServiceClient, userId: string) {
  return {
    userId,
    /** A SELECT over `table`, pre-filtered to this tenant's rows. */
    selectOwn(table: TenantTable, columns = "*") {
      return client.from(table).select(columns).eq("user_id", userId);
    },
    /**
     * Tenant-scoped single-row read by id, returning the caller-declared projection
     * type `T` (or null). Folds the two things every `selectOwn(...).eq("id").maybeSingle()`
     * call site otherwise repeats: the id filter and the `as unknown as T` cast that
     * supabase-js forces (a runtime column string yields no inferred row type). Still
     * tenant-scoped by the .eq("user_id") filter (constitution NEVER #4): a row that is
     * missing or owned by another tenant both read as null, indistinguishably. Throws on
     * a query error (never returns a partial/ambiguous result).
     */
    async selectOwnById<T>(table: TenantTable, id: string, columns: string): Promise<T | null> {
      const { data, error } = await client
        .from(table)
        .select(columns)
        .eq("user_id", userId)
        .eq("id", id)
        .maybeSingle();
      if (error) {
        throw new Error(`${table} tenant-scoped read failed: ${error.message}`);
      }
      return (data ?? null) as unknown as T | null;
    },
  };
}

export type TenantClient = ReturnType<typeof forUser>;

/**
 * Tenant-scoped credit balance = Σ delta over the user's ledger, read from the
 * `credit_balances` aggregate view (migration 0002). Balance derives ONLY from the ledger
 * sum, never a stored counter (constitution NEVER #2). Reading the view rather than summing
 * raw delta rows app-side is a CORRECTNESS requirement, not a style choice: an app-side
 * `select("delta")` + reduce is silently truncated by PostgREST's max_rows (1000) cap, so a
 * 1000+ row ledger under-reports the balance with NO error. The view's SUM runs server-side
 * and returns a single row, immune to the page cap. The explicit .eq("user_id", …) filter is
 * the tenant guard on this RLS-bypassing service client (NEVER #4): the view is
 * security_invoker, so service_role sees every user's row and the filter is what scopes it to
 * one tenant. maybeSingle → 0 for a user with no ledger rows.
 */
export async function creditBalance(client: ServiceClient, userId: string): Promise<number> {
  const { data, error } = await client
    .from("credit_balances")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`credit_balances read failed: ${error.message}`);
  }
  return data?.balance ?? 0;
}
