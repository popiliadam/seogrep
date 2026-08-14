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
 *
 * PostgrestVersion is the stack's MEASURED version (T3), matching what the @pseo/db generator
 * pins from the running PostgREST. This slice hand-declares it, so it can drift from the
 * generated types in a way nothing else catches — and it had: it said "14.5", a version this
 * stack has never run. Documentary only: postgrest-js gates on the MAJOR prefix
 * (`V extends "14" + string`), so both strings unlock exactly the same client methods. That
 * equivalence was measured, not assumed — see the T3 commit message for the probe.
 */
export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.14";
  };
  public: {
    Tables: {
      // Hashed, revocable personal API keys, including last_used_at (migration 0009) — which
      // the generated @pseo/db types now carry too; this slice is narrow, not ahead of them.
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
          // null = aktif. Migration 0022. Bir tarih = kullanıcı bu projeyi ekrandan
          // çıkardı; satır ve bütün geçmişi duruyor.
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          domain: string;
          created_at?: string;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          domain?: string;
          created_at?: string;
          archived_at?: string | null;
        };
        Relationships: [];
      };
      // The DataForSEO daily-budget ledger (migration 0014). Writes go exclusively through the
      // reserve_dfs_spend / settle_dfs_spend RPCs — this Row exists only so the reaper can READ
      // abandoned reservations for its heartbeat. Insert/Update are deliberately absent from the
      // app's usage: nothing here may write the money ledger directly.
      dfs_spend: {
        Row: {
          id: string;
          spend_day: string;
          endpoint: string;
          estimated_usd: number;
          actual_usd: number | null;
          row_count: number | null;
          status: string;
          created_at: string;
          settled_at: string | null;
        };
        Insert: never;
        Update: never;
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
      // Per-project Google Search Console link (migrations 0003 + 0009 + 0021). Stores the
      // resolved property and, since 0021, an `account_id` pointing at the `gsc_accounts` row
      // that actually holds the sealed refresh token — 0021 DROPPED
      // `gsc_connections.encrypted_refresh_token` outright (the credential moved off the
      // per-project axis onto the per-account one; see the gsc_accounts table below). The web
      // OAuth callback writes account_id; pull_gsc_data reads it back tenant-scoped by user_id
      // (constitution NEVER #4), then resolves the token through gsc_accounts. A null account_id
      // means "not connected" — same as no row at all — because `on delete set null` (0021) is
      // how detaching an account normalizes back to that state. gsc_property is migration 0009,
      // which the committed @pseo/db generated types still omit, so it is modeled here.
      gsc_connections: {
        Row: {
          id: string;
          user_id: string;
          project_id: string;
          account_id: string | null;
          gsc_property: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id: string;
          account_id?: string | null;
          gsc_property?: string | null;
          created_at?: string;
        };
        Update: {
          account_id?: string | null;
          gsc_property?: string | null;
        };
        Relationships: [];
      };
      // One row per Google account a user has connected (migration 0021), keyed on
      // (user_id, google_account_sub) — the SUB, never the email, because email can change and
      // sub cannot. Holds the AES-256-GCM-sealed refresh token (bytea, read back as a \x-hex
      // string), bound to THIS row's (user_id, id) via the crypto v4 AAD (@pseo/core's
      // TokenOwner) — a blob moved to another row fails to authenticate there. `authenticated`
      // has only a column-level grant that EXCLUDES encrypted_refresh_token (migration 0021);
      // only service_role — this client — can ever reach the ciphertext, so the explicit
      // `.eq("user_id", …)` on every read is the ONLY tenant guard (constitution NEVER #4), not
      // a redundant belt-and-suspenders check on top of RLS. The credential write path
      // (upsertGscAccount / accessTokenFor) lives in apps/web/lib/gsc/accounts.ts (Task 4) —
      // hand-declared here in the same style rather than imported, matching every other table in
      // this slice. This app READS the row and writes exactly ONE field of it: markGscAccountTokenInvalid
      // below stamps token_status='invalid' when Google refuses a refresh, because that death is
      // observed HERE while the recovery UI lives in the web app. Insert is modelled for the
      // schema's sake; nothing in apps/mcp inserts.
      gsc_accounts: {
        Row: {
          id: string;
          user_id: string;
          google_account_sub: string;
          google_account_email: string;
          encrypted_refresh_token: string;
          token_status: "active" | "invalid";
          token_checked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          google_account_sub: string;
          google_account_email: string;
          encrypted_refresh_token: string;
          token_status?: "active" | "invalid";
          token_checked_at?: string | null;
          created_at?: string;
        };
        Update: {
          token_status?: "active" | "invalid";
          token_checked_at?: string | null;
        };
        Relationships: [];
      };
      // One row per crawled page (and per skipped URL) of a crawl_site run, migration 0023 —
      // the row axis beside the single `jobs.result` jsonb, written by the queue handler's
      // dual write (queue/handlers/crawl-pages.ts) and read by nothing yet, on purpose.
      //
      // Update is `never`, matching the migration: service_role is granted SELECT + INSERT and
      // deliberately NOT update/delete. A crawl's rows are that crawl's output — there is
      // nothing here to correct later, and keeping the table append-only means no row can be
      // moved out from under the next slice's readers. Rows leave only with their parent job or
      // project (ON DELETE CASCADE).
      crawl_pages: {
        Row: {
          id: string;
          user_id: string;
          project_id: string;
          job_id: string;
          kind: "page" | "skipped";
          url: string;
          status: number | null;
          title: string | null;
          meta_description: string | null;
          h1s: Json | null;
          canonical: string | null;
          robots_meta: string | null;
          links: Json | null;
          word_count: number | null;
          json_ld_types: Json | null;
          issues: Json | null;
          reason: string | null;
          seq: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id: string;
          job_id: string;
          kind: string;
          url: string;
          status?: number | null;
          title?: string | null;
          meta_description?: string | null;
          h1s?: Json | null;
          canonical?: string | null;
          robots_meta?: string | null;
          links?: Json | null;
          word_count?: number | null;
          json_ld_types?: Json | null;
          issues?: Json | null;
          reason?: string | null;
          seq: number;
          created_at?: string;
        };
        Update: {
          [_ in never]: never;
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
      // The migration-0014 DataForSEO vendor-budget RPCs (dfs/budget.ts). VENDOR spend, not
      // user credits — a separate counter with its own per-day advisory lock. The dfs_spend
      // table itself is deliberately NOT modelled above: it carries no user_id (it is operator
      // accounting, not tenant data), and the app reaches it only through these functions.
      reserve_dfs_spend: { Args: { p_estimated_usd: number; p_endpoint: string }; Returns: string };
      settle_dfs_spend: {
        Args: { p_reservation_id: string; p_actual_usd: number; p_row_count: number };
        Returns: undefined;
      };
      dfs_spend_today_usd: { Args: Record<string, never>; Returns: number };
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
/**
 * The tables `forUser` may scope, DERIVED from which of them actually carry a user_id rather
 * than assumed to be all of them.
 *
 * `keyof Tables` was the old definition, and it quietly depended on every table in the slice
 * being tenant-owned. The moment a table without a user_id was added (dfs_spend — a
 * fleet-global money ledger, not a tenant one), `selectOwn`'s filter type collapsed to the
 * columns common to ALL tables and `.eq("user_id", …)` stopped type-checking across the app.
 * That failure was loud, but the quiet direction is the dangerous one: this type is what
 * makes a cross-tenant read a compile error (constitution NEVER #4), and it should say what
 * it means instead of relying on a coincidence about the slice's contents.
 *
 * Purely a narrowing: every table that WAS scopable still is, so no existing call changes.
 */
export type TenantTable = {
  [K in keyof Database["public"]["Tables"]]: Database["public"]["Tables"][K]["Row"] extends {
    user_id: string;
  }
    ? K
    : never;
}[keyof Database["public"]["Tables"]];

/**
 * Compile-time proof of the line above, kept in a file the typecheck gate actually reads.
 *
 * The obvious home for this is a spec, but `tsconfig.json` excludes `src/**` + `*.test.ts`, so a
 * `@ts-expect-error` there is decorative — verified by mutation: deleting the directive changed
 * nothing. Here, breaking the invariant fails `pnpm typecheck`, which is a real gate.
 *
 * If a future table without a user_id becomes scopable by forUser, this stops compiling.
 */
type AssertNotTenantScopable<T extends string> = T extends TenantTable ? never : true;
const _dfsSpendIsNotTenantScopable: AssertNotTenantScopable<"dfs_spend"> = true;
void _dfsSpendIsNotTenantScopable;

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
 * Count jobs currently `queued` or `running` — the gateway's own view of queue backlog /
 * stuck work, surfaced on the unauthenticated `/status` operator endpoint. This is a
 * PROCESS-WIDE aggregate and is deliberately NOT tenant-scoped: it returns only a single
 * integer (head:true transfers ZERO rows, so no tenant data leaves the database), which is
 * why the `user_id` filter that guards tenant DATA reads (constitution NEVER #4) does not
 * apply here. NOTE: there is no dedicated index on `jobs.status` today, so this is a plain
 * count over the jobs table — cheap at beta volume, and the `/status` caller bounds it with
 * a short timeout + best-effort `null` fallback regardless. Throws on a query error; the
 * caller degrades to `null` rather than failing `/status`.
 *
 * `signal` makes the read CANCELLABLE, which is what makes the caller's timeout honest: a
 * bound that only abandons the ANSWER leaves the request running, so a flood of abandoned
 * `/status` calls still piles unindexed counts onto the database every other subsystem
 * shares. Passing the signal through to PostgREST tears the HTTP request down when the
 * caller gives up. It is optional so the reader stays usable off the `/status` path.
 */
export async function countPendingJobs(
  client: ServiceClient,
  signal?: AbortSignal,
): Promise<number> {
  const query = client
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "running"]);
  const { count, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) {
    throw new Error(`jobs pending count failed: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * The DB object `/status` probes to answer the question nothing in this repo could answer
 * before: does the CLOUD database actually carry the schema this BUILD calls? Code and
 * migrations merge together but deploy INDEPENDENTLY, so Fly can start serving a build whose
 * RPCs the cloud project has never seen.
 *
 * Why a CAPABILITY probe and not a version read: `supabase_migrations.schema_migrations` is not
 * in the `public` schema, not in the generated types, and not reachable through this typed
 * service client — and a version number only tells you what was RECORDED, never what is
 * callable. Asking the database to run the thing is the honest question.
 *
 * Why THIS object is the sentinel:
 *   - it is the NEWEST database capability apps/mcp actually calls (migration 0014's vendor
 *     budget; 0015-0018 add armor — triggers, constraints, grants — which this gateway never
 *     names), so it is precisely the object whose absence breaks this service at runtime;
 *   - it is `language sql stable` over one UTC day of `dfs_spend`: read-only by SQL contract,
 *     no advisory lock, no write, no side effect, and it returns a single numeric;
 *   - `dfs/budget.ts` already depends on it, so a `not_ready` here is a REAL fault report, not
 *     a synthetic canary that could pass while the app is broken.
 * Rename or drop it in the migrations and apps/mcp's db.schema.test.ts pin goes red.
 */
export const SCHEMA_SENTINEL_RPC = "dfs_spend_today_usd";

/** The two DEFINITIVE answers the probe can get from the database. Everything else throws. */
export type SchemaProbeResult = "ready" | "not_ready";

/**
 * Error codes that mean the object is DEFINITIVELY not there: PostgREST's own
 * "function not found in the schema cache", and Postgres SQLSTATE 42883 (undefined_function)
 * when the engine is the one to answer. Any OTHER failure is ambiguous by construction.
 */
const MISSING_OBJECT_CODES: readonly string[] = ["PGRST202", "42883"];

/**
 * Probe whether the connected database carries the sentinel capability (see above). Returns a
 * DEFINITIVE answer or THROWS — it never guesses. That split is the whole point: a probe that
 * folded a timeout or a permission error into `ready` would report a measurement it never took
 * (signed lesson 7), and folding it into `not_ready` would cry wolf about a healthy schema.
 * The caller (`/status`) owns the degradation policy and reports `unknown` for a throw.
 *
 * `signal` makes the probe CANCELLABLE for the same reason countPendingJobs takes one: a bound
 * that only abandons the ANSWER leaves the query running underneath.
 */
export async function probeSchemaSentinel(
  client: ServiceClient,
  signal?: AbortSignal,
): Promise<SchemaProbeResult> {
  const query = client.rpc(SCHEMA_SENTINEL_RPC);
  const { error } = await (signal ? query.abortSignal(signal) : query);
  if (!error) return "ready";
  if (MISSING_OBJECT_CODES.includes(error.code)) return "not_ready";
  throw new Error(
    `schema readiness probe (${SCHEMA_SENTINEL_RPC}) failed with ${error.code || "no code"}: ${error.message}`,
  );
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
 * Record that Google refused this account's refresh token with `invalid_grant`, so the account
 * picker and the discovery tools can say "reconnect" instead of guessing.
 *
 * WHY IT LIVES HERE AND NOT IN apps/web. `markAccountTokenStatus` already exists in
 * apps/web/lib/gsc/accounts.ts, and this is deliberately NOT that function: apps/mcp depends on
 * @pseo/core, @supabase/supabase-js, express, pg-boss, undici and zod — never on apps/web — and
 * the write cannot move to packages/core either, whose one runtime dependency is zod. The
 * duplication across the app boundary is the same convention as the hand-declared gsc_accounts
 * row shape above, for the same reason.
 *
 * WHY "INVALID" ONLY. Migration 0021's note on the column and apps/web's twin both draw the same
 * line: `invalid` means Google specifically said `invalid_grant`. A 5xx, a timeout or a network
 * error must never reach this function — a transient outage is not a dead credential, and
 * branding a live account invalid sends the user through an OAuth round for nothing. The MCP
 * read path has no reason to write `active` back (a re-consent already does that, in the web
 * upsert), so this helper cannot express it.
 *
 * The `.eq("user_id", …)` filter is the ONLY tenant guard: this client is service-role, and
 * `authenticated` has no UPDATE grant on gsc_accounts at all, so without the filter an
 * `accountId` from a corrupted connection row could flip a FOREIGN tenant's token_status and
 * prompt a stranger to re-authorize (constitution NEVER #4).
 *
 * Throws on a query error; the caller decides whether to swallow it (pull_gsc_data does, so a
 * DB blip can never replace the invalid_grant answer the user needs).
 */
export async function markGscAccountTokenInvalid(
  client: ServiceClient,
  accountId: string,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("gsc_accounts")
    .update({ token_status: "invalid", token_checked_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("user_id", userId);
  if (error) {
    throw new Error(`gsc_accounts status write failed: ${error.message}`);
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
