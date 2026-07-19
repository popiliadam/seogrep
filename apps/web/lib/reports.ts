import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@pseo/db/server";

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

/**
 * Resolve one report by its public slug for the public page, or null when the slug matches
 * nothing OR the matched row has no rendered html. Uses the service-role client (deliberate,
 * slug-scoped bypass — see the module header).
 */
export async function fetchPublicReportBySlug(slug: string): Promise<PublicReport | null> {
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
    return null;
  }
  return { title: row.title, html: row.html };
}
