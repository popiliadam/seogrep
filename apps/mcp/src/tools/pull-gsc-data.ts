import { z } from "zod";
import { decryptToken, fromByteaHex } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import { getServiceClient, markGscAccountTokenInvalid, type Json } from "../db.ts";
import { requireTokenEncryptionKey } from "../env.ts";
import { recordSucceededPull } from "../queue/boss.ts";
import { defaultGscApi, runPull, type GscApi } from "../gsc-data/pull.ts";
import { pullResultToJson } from "../gsc-data/types.ts";
import { formatPullSummary } from "../gsc-data/format.ts";
import { GscReauthRequiredError, isInvalidGrant } from "../gsc-data/reauth-error.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";
import { optionalGscConnectUrl } from "./connect-gsc.ts";
import { PreconditionNotMetError } from "./precondition.ts";

/**
 * pull_gsc_data — 5 credits, SYNC. Fetches two adjacent windows of Search Console
 * performance (current + previous `days`-day windows) for a connected project and stores
 * them for the discovery tools (find_quick_wins / detect_cannibalization /
 * analyze_content_decay) to read.
 *
 * It is a defineTool with the DEFAULT "surface" charge: reserve -> handler -> commit / release.
 * withCredits COMMITS a handler that RETURNS and RELEASES only on a THROW, so the money rule
 * is: anything that means "no pull happened" must THROW (no charge), and a stored pull must
 * RETURN (charge 5). Concretely — a missing connection, an unmatched property, and a failed
 * Google call all THROW (released, never charged); only a completed, stored pull commits. A
 * pull that returns zero rows is still a delivered pull and DOES commit (the account genuinely
 * has no data — the discovery tools then report "no findings").
 *
 * Those throws are not all the same KIND, and the registry sorts them by TYPE. The two CONNECTION
 * states below — no connection, no matched property — are designed refusals with a sentence
 * already written for the user, so they carry PreconditionNotMetError and reach the client
 * verbatim. (Migration 0021 retired a third state that used to sit between them, "connection
 * exists but has no stored token yet": the credential moved to gsc_accounts, whose
 * encrypted_refresh_token is NOT NULL, so a connection's account_id is now either unset — "not
 * connected", same message as no row — or names an account that, by construction, has a token.
 * See the commit message for the full per-assertion account of what moved and what dropped.)
 * The unmatched-property one is not hypothetical: on 2026-08-09 a live project
 * (www.noraninsaat.com) sat in exactly that state and was handed "failed unexpectedly, quote
 * reference X" while its answer sat three lines away in this file (measured and recorded as
 * finding #36 in docs/testing/2026-08-09-cok-site-kampanya.md). A THIRD refusal joins them at
 * the Google call: a 403 on searchAnalytics.query, which is a permission fact about the user's
 * own property rather than a fault — it carries the same type so its sentence survives, and it
 * is the only one that logs (see the branch for why). A FOURTH sits one call EARLIER, at the
 * token refresh: `invalid_grant` means the stored credential is dead and only the USER can
 * replace it, so it carries GscReauthRequiredError — a different type, because its sentence is
 * built from typed fields (which account, which link) rather than passed through, and because it
 * also WRITES what it observed (`token_status='invalid'`) so the account picker and the discovery
 * tools can say so without repeating the call. A lookup error, a missing account row, a token
 * that will not decrypt, and every OTHER Google failure — including a 5xx from that same token
 * endpoint — stay plain Errors and keep the generic sentence + the server log line: each of those
 * is a real fault with something for an operator to read, and a transient outage is not a dead
 * credential.
 *
 * The stored jobs row is a pure DATA CARRIER: reserve_id stays null (the spend is on the
 * ledger, sync-surface style), so this never double-charges against a worker reserve.
 * Google is a single injected port (GscApi) — tests run with ZERO network (NEVER #5).
 */

const MIN_DAYS = 7;
const MAX_DAYS = 90;

const inputSchema = z.object({
  project_id: z.uuid().describe("The connected project to pull (from setup_project / list_projects)."),
  days: z
    .number()
    .int()
    .min(MIN_DAYS)
    .max(MAX_DAYS)
    .default(MAX_DAYS)
    .describe("Window length in days per period (7–90, default 90). Compares this window with the one before it."),
});

/**
 * The connection fields pull_gsc_data reads (tenant-scoped). Migration 0021 moved the
 * credential off this row onto `gsc_accounts`; `account_id` is what links the two. A null
 * `account_id` means "not connected" — same as no row at all (see loadAccountToken below).
 */
export interface GscConnectionRow {
  readonly account_id: string | null;
  readonly gsc_property: string | null;
}

/** Load a project's GSC connection, tenant-scoped by user_id (null when there is none). */
export type LoadConnectionFn = (
  userId: string,
  projectId: string,
) => Promise<GscConnectionRow | null>;

/**
 * The `gsc_accounts` fields pull_gsc_data needs once a connection names an account: the sealed
 * credential, and the account's email — the label the reauth sentence names, because a user with
 * several connected Google accounts otherwise cannot tell WHICH one to reconnect.
 */
export interface GscAccountTokenRow {
  readonly encrypted_refresh_token: string;
  readonly google_account_email: string;
}

/**
 * Load one `gsc_accounts` row's sealed token, tenant-scoped by user_id (null when the id is
 * unknown OR belongs to another tenant — the two are indistinguishable, same as loadConnection).
 */
export type LoadAccountTokenFn = (
  accountId: string,
  userId: string,
) => Promise<GscAccountTokenRow | null>;

/** The jobs writer port (default: recordSucceededPull over the service client). */
export type RecordPullFn = (params: {
  userId: string;
  projectId: string;
  result: Json;
}) => Promise<{ jobId: string }>;

export interface PullGscDataDeps {
  /** GSC connection reader (default: tenant-scoped gsc_connections read). */
  readonly loadConnection?: LoadConnectionFn;
  /** GSC account token reader (default: tenant-scoped gsc_accounts read). */
  readonly loadAccountToken?: LoadAccountTokenFn;
  /** Google client port (default: the real @pseo/core client). */
  readonly api?: GscApi;
  /** Succeeded-pull recorder (default: recordSucceededPull). */
  readonly recordPull?: RecordPullFn;
  /** Injectable clock for deterministic windows (default: now). */
  readonly now?: () => Date;
  /** The at-rest key that opens the sealed refresh token (default: env, fail-closed). */
  readonly encryptionKey?: string;
}

/**
 * The default gsc_connections reader, scoped to the tenant by an explicit user_id filter
 * (constitution NEVER #4) AND project_id. The literal table gives the specific row type, so
 * the project_id filter type-checks (forUser's selectOwn narrows filters to the columns
 * common to ALL tenant tables, which excludes project_id).
 */
const defaultLoadConnection: LoadConnectionFn = async (userId, projectId) => {
  const { data, error } = await getServiceClient()
    .from("gsc_connections")
    .select("account_id, gsc_property")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    throw new Error(`pull_gsc_data: connection lookup failed: ${error.message}`);
  }
  return data ?? null;
};

/**
 * The default gsc_accounts reader, scoped to the tenant by an explicit user_id filter AND the
 * account id (constitution NEVER #4 — service_role bypasses RLS, so this filter is the ONLY
 * tenant guard on the table holding every Google credential in the product). A row that is
 * missing or belongs to another tenant both read as null — mutation-tested: dropping the
 * user_id filter here is what pull-gsc-data.db.test.ts's SECURITY spec catches.
 */
const defaultLoadAccountToken: LoadAccountTokenFn = async (accountId, userId) => {
  const { data, error } = await getServiceClient()
    .from("gsc_accounts")
    .select("encrypted_refresh_token, google_account_email")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`pull_gsc_data: account token lookup failed: ${error.message}`);
  }
  return data ?? null;
};

const defaultRecordPull: RecordPullFn = (params) => recordSucceededPull(getServiceClient(), params);

/**
 * The prefix @pseo/core's `apiError` builds when Google REFUSES a searchAnalytics.query:
 * `Google searchAnalytics.query failed (403): User does not have sufficient permission for
 * site '...'`. Measured live 2026-08-09 (Fly refs f05822b1, bb08959c) on two projects bound to
 * a property their account could list but not read.
 *
 * Keying on the MESSAGE is the opposite of the rule registry.ts states for OUR OWN refusals
 * ("keys on the TYPE, never on the text"), and it is deliberate here for a different subject:
 * this classifies a THIRD PARTY's failure, and the port that carries it (GscApi) hands us a
 * bare Error with no status on it. The string is not Google's, though — it is built by our own
 * client and the surface+status are literals in it, so this is a contract between two files in
 * this repo. It is pinned end-to-end: the db spec drives the REAL @pseo/core client with a
 * fake 403 fetch and feeds the resulting Error through this branch, so a reword in core fails
 * the test rather than silently re-generalising this refusal.
 *
 * Narrow on purpose: only searchAnalytics.query, only 403. A 403 from the token endpoint is a
 * different sentence (a revoked grant), and every other Google failure keeps the generic
 * crash sentence + reference + log line, which is what stops this branch creeping wider.
 */
const SEARCH_ANALYTICS_FORBIDDEN_PREFIX = "Google searchAnalytics.query failed (403)";

function isSearchAnalyticsForbidden(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith(SEARCH_ANALYTICS_FORBIDDEN_PREFIX);
}

/**
 * What the user is told when Google refuses the property. No enum value and no Google internals
 * — a sentence with the two actions that actually clear it. The property string is echoed
 * because it is THIS connection's own stored value, resolved from the caller's own Google
 * account at connect time; naming it is what lets a user with several properties know which one
 * to fix. "No credits were charged" is a fact of the throw below, not a courtesy.
 */
function forbiddenPropertyMessage(property: string): string {
  return (
    `Google refused Search Console data for this project's property (${property}): the connected ` +
    "Google account does not have permission to read it. Ask an owner of that property to give " +
    "this account access under Settings > Users and permissions in Search Console (or finish " +
    "verifying the property, if it is listed but unverified) — or re-run connect_gsc and approve " +
    "with an account that already has access. No credits were charged."
  );
}

/**
 * Build the pull_gsc_data tool. All I/O is injectable so the DB-integration spec can use a
 * fake Google port (zero network) over the real DB, and unit tests can fake everything.
 */
export function makePullGscDataTool(deps: PullGscDataDeps = {}): RegisteredTool {
  const loadConnection = deps.loadConnection ?? defaultLoadConnection;
  const loadAccountToken = deps.loadAccountToken ?? defaultLoadAccountToken;
  const api = deps.api ?? defaultGscApi;
  const recordPull = deps.recordPull ?? defaultRecordPull;
  const now = deps.now ?? ((): Date => new Date());
  return defineTool({
    name: "pull_gsc_data",
    description:
      "Pull two windows of Google Search Console performance (current + previous period) for " +
      "a connected project, so find_quick_wins / detect_cannibalization / analyze_content_decay " +
      "can analyze it. Costs 5 credits. Run connect_gsc first.",
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx: AuthContext, { project_id, days }) => {
      const connection = await loadConnection(ctx.userId, project_id);
      // Both mean "nothing to pull" -> THROW so withCredits RELEASES (no charge), and TYPED so
      // the registry renders each sentence verbatim rather than replacing it with the generic
      // crash sentence. A missing project and another tenant's project are indistinguishable
      // here (the read is tenant-scoped), and echoing project_id back does not change that — it
      // is the caller's own input.
      //
      // A null account_id (migration 0021) means exactly the same thing as no row at all: the
      // web callback only ever sets it once the OAuth round-trip stores a token, and detaching
      // an account normalizes a connection back to this same null (`on delete set null`) — so
      // there is deliberately no separate "connection exists but has no token yet" state any
      // more (dropped from the v3 shape below; see the commit message for why). This still
      // shares one message with the "no row" case, not a NEW error class — Task 8 owns the
      // typed reauth error the account's own token_status will eventually drive.
      if (!connection || !connection.account_id) {
        throw new PreconditionNotMetError(
          `No Search Console connection for project ${project_id}. Run connect_gsc first.`,
        );
      }
      if (!connection.gsc_property) {
        throw new PreconditionNotMetError(
          "This project's Search Console connection has no matched property yet. Reconnect once the property is verified in Search Console.",
        );
      }

      // The account row is expected to exist (a non-null account_id names a real gsc_accounts
      // row `on delete set null` would otherwise have cleared) — null here means a genuine data
      // anomaly, so it is a plain Error (generic crash sentence + log line), never a designed
      // refusal with a user-facing action.
      const account = await loadAccountToken(connection.account_id, ctx.userId);
      if (!account) {
        throw new Error(
          `pull_gsc_data: gsc_accounts row ${connection.account_id} not found for connected project ${project_id}`,
        );
      }

      const encryptionKey = deps.encryptionKey ?? requireTokenEncryptionKey();
      // Open the seal against the SAME (user, account) the row was loaded by (M-17, rebound to
      // the account axis by migration 0021 / @pseo/core crypto v4). A blob authenticates only
      // under its own row's ids, so a token planted into this row from another user's account
      // fails here instead of driving their Google grant. The throw releases the credit
      // reserve, exactly like the other "nothing to pull" exits.
      const refreshToken = decryptToken(
        fromByteaHex(account.encrypted_refresh_token),
        encryptionKey,
        { userId: ctx.userId, accountId: connection.account_id },
      );

      // A Google failure here THROWS -> released, never charged. That must stay true of the
      // 403 branch below too: it RE-throws, so the money behaviour is untouched (measured
      // live — the balance did not move across four of these failures).
      //
      // WHY THIS ONE FAILURE IS RE-DRESSED. A 403 on searchAnalytics.query is not a crash: it
      // is Google stating a permission fact about the caller's own property, and the user has
      // two concrete actions for it. Handed to the registry's generic branch it became "failed
      // unexpectedly … quote reference f05822b1" — an instruction to file a bug about a
      // correctly-working permission system, which is what two live projects received on every
      // call for hours.
      //
      // It carries PreconditionNotMetError because that TYPE is what the registry reads as
      // "designed refusal, sentence already written, render it verbatim" — and because the
      // money rule leaves no alternative: returning an errorResult would COMMIT the 5 credits
      // for a call that fetched nothing. It is the least comfortable of the four uses: the
      // other three are states with nothing for an operator to read, and this one has Google's
      // own message. So this branch — alone among them — logs that message ITSELF before
      // throwing, because the registry's precondition path deliberately emits no log line. The
      // operator keeps the verbatim external error; the user stops being told to report a bug.
      // The 8-hex reference is the one thing not reproduced, and it correlates a sentence that
      // says nothing to a log line — here the sentence names the state, and project_id is the
      // handle. A wider branch (any 403, any Google error) would re-hide the real faults the
      // 2026-08-09 campaign found wearing the generic sentence, so it stays this narrow.
      const property = connection.gsc_property;
      const accountId = connection.account_id;
      const pull = await runPull({
        refreshToken,
        property,
        days,
        reference: now(),
        api,
      }).catch(async (error: unknown): Promise<never> => {
        // THE DEAD GRANT. Derived from the failure we JUST saw, never from the token_status we
        // read earlier: the stored column is a record of the last observation, and on the very
        // first death there is nothing recorded yet — which is precisely the state all 12
        // measured invalid_grant failures were in (migration 0021's header). Reading state here
        // would leave the feature blind exactly where credentials actually die.
        //
        // The write below is what makes the stored column true afterwards, so the account picker
        // and the discovery tools can warn without repeating this call. It is best-effort by
        // design: if the status write itself fails, the ORIGINAL diagnosis must still reach the
        // user — a DB blip that downgraded "reconnect your account" to "try again later" would
        // leave them retrying a credential that can never work (the same log-and-swallow apps/web
        // uses on its own refresh path).
        if (isInvalidGrant(error)) {
          try {
            await markGscAccountTokenInvalid(getServiceClient(), accountId, ctx.userId);
          } catch (statusError) {
            console.error(
              `pull_gsc_data: failed to mark account ${accountId} invalid after invalid_grant`,
              statusError,
            );
          }
          // THROW, so withCredits RELEASES: a revoked grant is not a purchase. The sentence the
          // user reads is built by the registry from these two fields (gsc-data/reauth-error.ts).
          //
          // The link is read SOFTLY: a deployment missing WEB_BASE_URL must still get the typed,
          // free, actionable refusal — a throw here would hand this exact failure back to the
          // generic "failed unexpectedly" branch, which is what this whole path removes.
          throw new GscReauthRequiredError(
            account.google_account_email,
            optionalGscConnectUrl(project_id),
          );
        }
        if (!isSearchAnalyticsForbidden(error)) {
          throw error;
        }
        console.error(
          `pull_gsc_data: Google refused the property for project ${project_id}: ${error.message}`,
        );
        throw new PreconditionNotMetError(forbiddenPropertyMessage(property));
      });

      // Store the pull as a succeeded jobs row (data carrier; reserve_id stays null), then
      // RETURN -> withCredits COMMITS the 5-credit spend.
      const { jobId } = await recordPull({
        userId: ctx.userId,
        projectId: project_id,
        result: pullResultToJson(pull),
      });
      return textResult(`${formatPullSummary(pull)}\njob_id: ${jobId}`);
    },
  });
}

/** The production pull_gsc_data tool (real DB + Google client). */
export const pullGscDataTool = makePullGscDataTool();
