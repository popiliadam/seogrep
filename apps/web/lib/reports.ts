import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@pseo/db/server";
import { clientIpFromHeaders, createRateLimiter, UNKNOWN_CLIENT } from "./rate-limit";

/**
 * Report reads for the web surface. Two deliberately-separate paths:
 *
 *   - listReports — the DASHBOARD list, read through the CALLER's authenticated client so RLS
 *     (`reports_select_own`) is the real tenant scope, with an explicit user_id filter as
 *     defence in depth (mirrors @pseo/db/ledger-read).
 *   - fetchPublicReportBySlug — the PUBLIC /r/[slug] read. There is no signed-in user there, so
 *     RLS (authenticated-only) would return nothing; this uses the service-role client as a
 *     NARROW, deliberate bypass keyed ONLY to the unguessable 64-bit public_slug. A NULL
 *     public_slug can never match a (non-empty) slug param, so a report without a slug is never
 *     served, and only the two presentational columns (title, html) are selected.
 *
 * server-only: this module imports the service-role factory and must never reach the browser.
 */

/** One report as the dashboard list renders it. */
export interface ReportListItem {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly publicSlug: string | null;
}

/** The presentational columns the public page renders. */
export interface PublicReport {
  readonly title: string | null;
  readonly html: string;
}

/** Cap the dashboard list — v0 has no paging (YAGNI); newest first. */
const MAX_REPORTS = 50;

/**
 * Flood controls in front of the PUBLIC lookup (L-14). That lookup runs the SERVICE-ROLE
 * client, so before this every anonymous GET /r/<anything> — a scanner walking random paths
 * included — became a Supabase read with no RLS policy and no ceiling in front of it.
 *
 * Two cheap layers, both consulted BEFORE the query:
 *
 *   1. NEGATIVE CACHE. A slug that resolved to "nothing servable" is remembered for
 *      MISS_TTL_MS, so hammering one dead link costs one read a minute instead of one per
 *      request. Only MISSES are cached: a report that DOES resolve is re-read every time, so
 *      revoking or re-rendering one takes effect immediately and no report body is ever held
 *      in this process. A read that FAILED is not cached either — an outage must not turn
 *      into a minute of manufactured 404s.
 *   2. PER-IP BUDGET. The flood a negative cache cannot help with is one that never repeats a
 *      slug. Each caller address gets LOOKUP_BURST reads at once, then LOOKUP_REFILL_PER_SECOND
 *      a second; over budget, the lookup answers "not found" WITHOUT querying. A throttled
 *      caller is therefore indistinguishable from a genuine miss and learns nothing from the
 *      difference — the cost being a false 404 for anyone genuinely exceeding ~60 distinct
 *      report reads a minute from one address, well above human reading.
 *
 * See lib/rate-limit for the honest limits: buckets are per PROCESS, so this bounds one
 * Netlify instance rather than the fleet, and an IP-rotating or distributed flood is not
 * stopped by it.
 */
const MISS_TTL_MS = 60_000;
const MAX_CACHED_MISSES = 5_000;
const LOOKUP_BURST = 60;
const LOOKUP_REFILL_PER_SECOND = 1;

/** slug -> epoch ms after which the remembered miss is stale. */
const missCache = new Map<string, number>();
const lookupThrottle = createRateLimiter({
  capacity: LOOKUP_BURST,
  refillPerSecond: LOOKUP_REFILL_PER_SECOND,
  maxEntries: 10_000,
});

function isKnownMiss(slug: string, nowMs: number): boolean {
  const expiresAtMs = missCache.get(slug);
  if (expiresAtMs === undefined) return false;
  if (expiresAtMs > nowMs) return true;
  missCache.delete(slug);
  return false;
}

function rememberMiss(slug: string, nowMs: number): void {
  // Bounded memory, same crude rule the rate limiter uses: clear everything rather than
  // grow without limit or carry an LRU.
  if (!missCache.has(slug) && missCache.size >= MAX_CACHED_MISSES) missCache.clear();
  missCache.set(slug, nowMs + MISS_TTL_MS);
}

/**
 * Bucket key for the public lookup. `headers()` only resolves inside a request, so a call
 * from anywhere else (a script, a unit test) falls back to the shared "unknown" bucket
 * instead of throwing — a throttle must never be the reason a report fails to render.
 */
async function lookupBucketKey(): Promise<string> {
  try {
    return clientIpFromHeaders(await headers());
  } catch {
    return UNKNOWN_CLIENT;
  }
}

/**
 * List the caller's reports, newest first. MUST be called with the caller's authenticated
 * client: RLS scopes the read to their own rows and the explicit user_id filter is defence in
 * depth. The stored 0009 columns (title) are not in the committed @pseo/db generated types, so
 * the projection is asserted here (the same runtime-column cast list_projects uses).
 */
export async function listReports(client: SupabaseClient, userId: string): Promise<ReportListItem[]> {
  const { data, error } = await client
    .from("reports")
    .select("id, title, created_at, public_slug")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_REPORTS);
  if (error) {
    throw new Error(`listReports failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as {
    id: string;
    title: string | null;
    created_at: string;
    public_slug: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    publicSlug: row.public_slug,
  }));
}

/** The tenant coordinates of ONE report. A report is addressed by (user, report id) — never id alone. */
export interface ReportRef {
  readonly userId: string;
  readonly reportId: string;
}

/**
 * Revoke a report's public link (L-13): null its `public_slug` so /r/<slug> resolves to nothing
 * and the page 404s. Returns whether a row was actually updated, so the caller can answer an
 * unknown / foreign id the same opaque way it answers a missing one.
 *
 * REVOKE ONLY — the row, its html and its title stay. Nothing here deletes a report, and the
 * UI must not promise that it does. Revoking twice is a no-op that still reports success: the
 * slug is already null and the link already dead.
 *
 * The slug is NOT rotated, it is dropped. A future generate_report mints a fresh 8-byte slug of
 * its own, so a revoked link is never re-issued to a later reader.
 *
 * Takes effect IMMEDIATELY: `fetchPublicReportBySlug` never caches a hit (see the flood-control
 * note above), and a NULL public_slug cannot match any non-empty slug param, so the next public
 * request misses. Only misses are cached, so at worst the dead link 404s a minute sooner.
 *
 * TENANT FILTER, NOT RLS. This runs the SERVICE-ROLE client, which is `rolbypassrls` — FORCE ROW
 * LEVEL SECURITY does not constrain it either. RLS therefore cannot save a missing filter here:
 * the `user_id` predicate riding on the UPDATE **is** the tenant guard (constitution NEVER #4),
 * exactly as in the api-keys and gsc_connections service-role paths. Its removal is not a style
 * regression, it is a cross-tenant write — reports.test.ts fails if it goes.
 *
 * UPDATE is already granted to service_role (migration 0006), so this needs no new grant and no
 * migration.
 */
export async function revokeReportLink(ref: ReportRef): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("reports")
    .update({ public_slug: null })
    .eq("user_id", ref.userId)
    .eq("id", ref.reportId)
    .select("id");
  if (error) {
    throw new Error(`revokeReportLink failed: ${error.message}`);
  }
  return ((data ?? []) as unknown as { id: string }[]).length > 0;
}

/**
 * Resolve one report by its public slug for the public page, or null when the slug matches
 * nothing OR the matched row has no rendered html. Uses the service-role client (deliberate,
 * slug-scoped bypass — see the module header).
 */
export async function fetchPublicReportBySlug(slug: string): Promise<PublicReport | null> {
  const nowMs = Date.now();
  if (isKnownMiss(slug, nowMs)) return null;
  if (!lookupThrottle.tryConsume(await lookupBucketKey())) return null;
  const { data, error } = await createServiceClient()
    .from("reports")
    .select("title, html")
    .eq("public_slug", slug)
    .maybeSingle();
  if (error) {
    throw new Error(`fetchPublicReportBySlug failed: ${error.message}`);
  }
  const row = (data ?? null) as unknown as { title: string | null; html: string | null } | null;
  if (!row || row.html === null || row.html === "") {
    rememberMiss(slug, nowMs);
    return null;
  }
  return { title: row.title, html: row.html };
}
