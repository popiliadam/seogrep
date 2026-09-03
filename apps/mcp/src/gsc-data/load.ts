import { DATA_FRESHNESS_DAYS, dataAgeInDays, describeDataAge, isStaleAge } from "@pseo/core";
import { getServiceClient } from "../db.ts";
import { getLatestSucceededPull } from "../queue/boss.ts";
import { renderReconnectInstruction } from "./reauth-error.ts";
import { parsePullResult, type PullData } from "./types.ts";

/**
 * Shared input port for the three discovery tools (find_quick_wins / detect_cannibalization
 * / analyze_content_decay): load the most recent SUCCEEDED pull for a project (tenant-scoped)
 * and hand back a ready-to-analyze PullData. All three read the same pull, so this is the ONE
 * place that resolves + defensively parses it — mirroring the audit slice's loadLatestCrawl.
 */

export type PullLoad =
  | {
      readonly ok: true;
      readonly pull: PullData;
      readonly pulledAt: string;
      /**
       * The `jobs` row the pull was read from — what `gsc_discovery_runs.pull_job_id` records, so
       * an analysis can be traced back to the exact pull it read (migration 0025).
       *
       * OPTIONAL on the type, ALWAYS present from this loader — the same split `CrawlLoad.jobId`
       * makes: it is optional so the DB-less fakes injected as `loadPull` in the fast lane keep
       * compiling, and that leniency is paid for at the call site rather than here.
       * `makeDiscoveryTool` THROWS when a tool that produces a structural report is handed a load
       * with no job id, so a missing id fails closed (no charge) instead of silently skipping the
       * write.
       */
      readonly jobId?: string;
    }
  | { readonly ok: false; readonly error: string };

/** The action-suggesting message a discovery tool gives when there is no pull to analyze. */
export const NO_PULL_MESSAGE =
  "No Search Console data found for this project. Run pull_gsc_data first.";

/**
 * The other half of that refusal, since B-4: the project has no Search Console connection at all,
 * so "run pull_gsc_data first" is an instruction that cannot succeed.
 *
 * Measured live 2026-09-03 — a project whose own listing says "Search Console: not connected" was
 * told to run pull_gsc_data, which then answered "Run connect_gsc first". Two paid-tool calls to
 * arrive at a fact the caller's project list already printed.
 */
export const NOT_CONNECTED_MESSAGE =
  "This project has no Search Console connection yet. Run connect_gsc first.";

export type LoadPullFn = (userId: string, projectId: string) => Promise<PullLoad>;

/**
 * Which of the two refusals a project with no pull deserves, from its connection state.
 *
 * BEST-EFFORT, and the fallback is the OLDER sentence. This read only chooses between two true
 * statements — the refusal is correct either way — so a health lookup that cannot answer must not
 * turn a designed refusal into a crash. The catch covers a synchronous throw as well as a rejected
 * promise: a service client that cannot even open a statement throws before the promise exists,
 * which is exactly what `findPriorAuditRun` was caught on (2026-09-03).
 *
 * NO EXISTENCE ORACLE IS OPENED. `loadGscTokenStatus` is tenant-scoped, so an unknown id, another
 * tenant's project and an own project with no connection all read null and all get the same
 * sentence; only a project that is BOTH this tenant's AND connected takes the other branch.
 */
async function noPullMessageFor(
  userId: string,
  projectId: string,
  loadTokenStatus: LoadTokenStatusFn,
): Promise<string> {
  try {
    return (await loadTokenStatus(userId, projectId)) === null
      ? NOT_CONNECTED_MESSAGE
      : NO_PULL_MESSAGE;
  } catch {
    return NO_PULL_MESSAGE;
  }
}

/**
 * Resolve the latest pull for (userId, projectId). A missing project, another tenant's project,
 * or a project never pulled all resolve to the SAME sentence for a given connection state — no
 * cross-tenant existence leak, and the message names the tool that can actually move the caller
 * forward (B-4). A stored result that will not parse is treated the same way. NOTE: a pull whose
 * windows are genuinely EMPTY (a property with no data) still loads ok — the analysis then reports
 * "no findings" over real, delivered data rather than pointing back at pull_gsc_data.
 *
 * `loadTokenStatus` is a port for the reason every other reader here is one: the default reaches
 * getServiceClient, which needs the full prod env, and both branches of B-4 have to be drivable
 * without a database.
 */
export async function loadLatestPull(
  userId: string,
  projectId: string,
  loadTokenStatus: LoadTokenStatusFn = loadGscTokenStatus,
): Promise<PullLoad> {
  const refuse = async (): Promise<PullLoad> => ({
    ok: false,
    error: await noPullMessageFor(userId, projectId, loadTokenStatus),
  });
  const latest = await getLatestSucceededPull(getServiceClient(), projectId, userId);
  if (!latest) return refuse();
  const pull = parsePullResult(latest.result);
  if (!pull) return refuse();
  // The timestamp was already fetched (getLatestSucceededResult selects created_at) and then
  // dropped here. The three discovery tools sell an ANALYSIS of this pull; an undated analysis
  // cannot be told from a fresh one.
  return { ok: true, pull, pulledAt: latest.createdAt, jobId: latest.jobId };
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
 * How old a pull has to be before the provenance line stops merely DATING the data and starts
 * calling it stale. A month is the point past which Search Console numbers describe a different
 * period than the one the reader is asking about — seasonality, a redesign, an algorithm update
 * — rather than a slightly older version of the same one.
 *
 * A named export rather than a literal buried in the sentence, so a test can pin the number a
 * user actually gets (the MAX_HREFLANGS pattern), and so this file states the threshold once.
 *
 * AN ALIAS SINCE 2026-08-25. The value now lives in @pseo/core's `guide/freshness`, alongside
 * `FRESHNESS_WINDOW_DAYS` (the whats_next router) and `STALE_CRAWL_DAYS` (the report). All three
 * were separate literal 30s in three packages, each with a comment explaining that it was
 * deliberately the same as the others — which is the shape a drift takes, not a defence against
 * one. The NAME stays because it is what this surface calls the threshold and because specs pin
 * it by name; only the number moved.
 */
export const STALE_PULL_DAYS = DATA_FRESHNESS_DAYS;

/**
 * The provenance line every discovery tool appends. ONE renderer, because three tools
 * printing the same fact three ways is how they drift apart.
 *
 * A bare date is the whole claim only while the data is recent. Past STALE_PULL_DAYS it needs a
 * SENTENCE: an analysis of a two-month-old pull is presented in exactly the same words as one of
 * this morning's, and the only difference a reader has to notice is a date at the very bottom of
 * a wall of findings — which is precisely the kind of difference nobody notices. Naming the
 * action too (re-run pull_gsc_data) is what turns the observation into something the user can do.
 *
 * This is the AGE axis and is independent of the reauth warning below, which is the CONNECTION
 * axis: a live connection can sit on ancient data, and a dead one can sit on data pulled an hour
 * before it died. Both lines can print, and when they do they say different things.
 */
export function renderPullProvenance(pulledAt: string, now: Date = new Date()): string {
  // The age arithmetic and the age WORDING both come from @pseo/core now, so this line and the
  // report's own age line cannot describe one pull two ways. Behaviour is unchanged: the same
  // floor-to-whole-days and the same today / 1 day ago / N days ago vocabulary, in one copy.
  const days = dataAgeInDays(pulledAt, now);
  const day = pulledAt.slice(0, 10);
  const staleness = isStaleAge(days)
    ? " This data is stale — run pull_gsc_data again for current numbers."
    : "";
  return `Search Console data pulled ${day} (${describeDataAge(days)}).${staleness}`;
}

/**
 * The staleness warning that follows the provenance line when the connection behind the data is
 * dead. Without it the provenance line is actively misleading: "pulled 12 days ago" reads as
 * "run pull_gsc_data for fresher numbers", when in fact pull_gsc_data cannot succeed at all until
 * the user re-approves — the state 12 measured cells were in on 2026-08-09.
 *
 * Deliberately says the connection expired and not WHY: the user's action is the same for every
 * cause, and this line sits under an analysis they came here to read, not under an error.
 *
 * A null `reconnectUrl` (no WEB_BASE_URL) drops the LINK, never the warning — same ruling as the
 * typed refusal: an environment problem must not silently delete a fact about the user's data.
 */
export function renderReauthWarning(reconnectUrl: string | null): string {
  return (
    "⚠ Your Google connection expired — this data cannot be refreshed. " +
    renderReconnectInstruction(reconnectUrl)
  );
}
