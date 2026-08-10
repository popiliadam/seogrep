import { getServiceClient } from "../db.ts";
import { getLatestSucceededPull } from "../queue/boss.ts";
import { parsePullResult, type PullData } from "./types.ts";

/**
 * Shared input port for the three discovery tools (find_quick_wins / detect_cannibalization
 * / analyze_content_decay): load the most recent SUCCEEDED pull for a project (tenant-scoped)
 * and hand back a ready-to-analyze PullData. All three read the same pull, so this is the ONE
 * place that resolves + defensively parses it — mirroring the audit slice's loadLatestCrawl.
 */

export type PullLoad =
  | { readonly ok: true; readonly pull: PullData; readonly pulledAt: string }
  | { readonly ok: false; readonly error: string };

/** The action-suggesting message a discovery tool gives when there is no pull to analyze. */
export const NO_PULL_MESSAGE =
  "No Search Console data found for this project. Run pull_gsc_data first.";

export type LoadPullFn = (userId: string, projectId: string) => Promise<PullLoad>;

/**
 * Resolve the latest pull for (userId, projectId). A missing project, another tenant's
 * project, or a project never pulled all resolve to the same NO_PULL_MESSAGE — no
 * cross-tenant existence leak, and the message tells the caller exactly what to do next. A
 * stored result that will not parse is treated the same way. NOTE: a pull whose windows are
 * genuinely EMPTY (a property with no data) still loads ok — the analysis then reports "no
 * findings" over real, delivered data rather than pointing back at pull_gsc_data.
 */
export async function loadLatestPull(userId: string, projectId: string): Promise<PullLoad> {
  const latest = await getLatestSucceededPull(getServiceClient(), projectId, userId);
  if (!latest) return { ok: false, error: NO_PULL_MESSAGE };
  const pull = parsePullResult(latest.result);
  if (!pull) return { ok: false, error: NO_PULL_MESSAGE };
  // The timestamp was already fetched (getLatestSucceededResult selects created_at) and then
  // dropped here. The three discovery tools sell an ANALYSIS of this pull; an undated analysis
  // cannot be told from a fresh one.
  return { ok: true, pull, pulledAt: latest.createdAt };
}

/**
 * The stored health of the Google account behind a project's connection (migration 0021).
 * `invalid` is written when Google itself answered `invalid_grant` on a refresh — by the web
 * refresh path and, since Task 8, by pull_gsc_data, which is where the deaths are actually
 * observed.
 */
export type GscTokenStatus = "active" | "invalid";

/** Read a project's connection health, tenant-scoped (null when there is no connection). */
export type LoadTokenStatusFn = (
  userId: string,
  projectId: string,
) => Promise<GscTokenStatus | null>;

/**
 * Resolve the token health behind a project's connection: gsc_connections.account_id ->
 * gsc_accounts.token_status, both reads filtered by user_id (constitution NEVER #4 — the
 * service-role client bypasses RLS, so these filters are the only tenant boundary).
 *
 * Null for "there is nothing to warn about": no connection row, no account linked, or an account
 * belonging to another tenant — which is indistinguishable from a missing one, deliberately, the
 * same way every other reader in this slice collapses those cases.
 *
 * THROWS on a query failure rather than answering "active". The caller (gsc-discovery-shared.ts)
 * owns the degradation policy and drops the warning, because a stale analysis with no warning is
 * a far smaller harm than a crashed one the user already paid for — but that is the CALLER's
 * decision to make explicitly, not a lie told here.
 *
 * Two round trips rather than a PostgREST embedded select: the embed needs a declared foreign-key
 * relationship in the hand-written schema slice (db.ts models `Relationships: []`), and buying a
 * saved round trip with a typed-schema fiction is not a trade this read needs.
 */
export async function loadGscTokenStatus(
  userId: string,
  projectId: string,
): Promise<GscTokenStatus | null> {
  const client = getServiceClient();
  const connection = await client
    .from("gsc_connections")
    .select("account_id")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (connection.error) {
    throw new Error(`gsc connection health lookup failed: ${connection.error.message}`);
  }
  const accountId = connection.data?.account_id;
  if (!accountId) return null;

  const account = await client
    .from("gsc_accounts")
    .select("token_status")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (account.error) {
    throw new Error(`gsc account health lookup failed: ${account.error.message}`);
  }
  return account.data?.token_status ?? null;
}

/**
 * The provenance line every discovery tool appends. ONE renderer, because three tools
 * printing the same fact three ways is how they drift apart.
 */
export function renderPullProvenance(pulledAt: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - Date.parse(pulledAt)) / 86_400_000);
  const day = pulledAt.slice(0, 10);
  const age = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  return `Search Console data pulled ${day} (${age}).`;
}

/**
 * The staleness warning that follows the provenance line when the connection behind the data is
 * dead. Without it the provenance line is actively misleading: "pulled 12 days ago" reads as
 * "run pull_gsc_data for fresher numbers", when in fact pull_gsc_data cannot succeed at all until
 * the user re-approves — the state 12 measured cells were in on 2026-08-09.
 *
 * Deliberately says the connection expired and not WHY: the user's action is the same for every
 * cause, and this line sits under an analysis they came here to read, not under an error.
 */
export function renderReauthWarning(reconnectUrl: string): string {
  return `⚠ Your Google connection expired — this data cannot be refreshed. Reconnect: ${reconnectUrl}`;
}
