import type { ServiceClient } from "../db.ts";
import { getServiceClient } from "../db.ts";

/**
 * Stuck-job reaper + reconciliation (audit §7). A crashed or redeployed worker can
 * leave a jobs row `running` with an OPEN credit reserve: the user was debited, the
 * work never delivered, and the reserve never settles. This module refunds those open
 * reserves and marks the jobs `failed`, so the balance is made whole and the user can
 * re-run the tool.
 *
 * MONEY DIRECTION — conservative refund. The crashed run did NOT deliver, so its reserve
 * is RELEASED (refunded). There is no automatic replay: the tool payload traveled in the
 * pg-boss queue message, not on the jobs row, so it is gone — the user re-runs. A
 * double-charge is impossible: commit and release are mutually exclusive under the
 * per-user advisory lock in migration 0005, so a reserve the real worker committed
 * concurrently comes back "already settled" here and is skipped (no second settlement).
 *
 * TWO LANES, because `jobs` cannot see every open reserve (H-01):
 *
 *   JOBS LANE   — aged `running` rows. Refunds their reserves and marks them failed.
 *   LEDGER LANE — aged `spend_reserve` rows with NO matching spend_commit/spend_release,
 *                 enumerated straight from credit_ledger and refunded REGARDLESS of whether a
 *                 jobs row exists or what status it holds. This lane was missing: a SYNC
 *                 surface tool has no jobs row at all, and the async worker marks a commit
 *                 failure `failed`, so BOTH shapes were invisible to a `status = 'running'`
 *                 scan — and to every detection query in reconciliation.md, which all started
 *                 from a jobs JOIN. Their reserves held the user's credits forever.
 *
 * This module NEVER writes the ledger directly: refunds go through the existing
 * release_reserve RPC (the only refund path, advisory-locked); everything else is table
 * reads and one status-guarded jobs UPDATE. guard.ts and the 0005 RPCs are untouched.
 */

/**
 * 15 minutes. MUST exceed the longest job runtime (the crawl time budget is 90s) so a
 * job that is genuinely still running is never reaped.
 */
const DEFAULT_OLDER_THAN_MS = 15 * 60_000;
/** The 15-minute default, in the minutes the CLI speaks. */
export const DEFAULT_OLDER_THAN_MINUTES = DEFAULT_OLDER_THAN_MS / 60_000;
/**
 * HARD FLOOR on the staleness window (L-16). Reaping a job releases its reserve and marks it
 * failed, so a window shorter than the longest tool runtime reaps LIVE work: the crawl time
 * budget alone is 90s, so 2 minutes is the lowest window that cannot hit a healthy job. The
 * CLI used to accept any finite positive number, so `--older-than-minutes=.15` — a plausible
 * typo for `15` — silently became a NINE SECOND window and a mutating sweep over running jobs.
 * Going below this is a deliberate act, not a typo: it needs allowUnsafeThreshold.
 */
export const MIN_OLDER_THAN_MS = 2 * 60_000;
/** The explicit opt-in that lets a caller go below MIN_OLDER_THAN_MS. Verbose on purpose. */
export const UNSAFE_THRESHOLD_FLAG = "--i-accept-refunding-live-jobs";
/**
 * The LEDGER lane's staleness window. Deliberately much wider than the jobs lane's 15 minutes:
 * this lane refunds on ledger evidence alone, so it must sit far above the longest run of ANY
 * tool — including the SYNC surface tools, which have no jobs row to age and are bounded only
 * by their HTTP call. 30 minutes is orders of magnitude past both, and the RPC's settled-guard
 * still arbitrates every individual release.
 */
const DEFAULT_ORPHAN_OLDER_THAN_MS = 30 * 60_000;
/**
 * The QUEUED lane's staleness window. enqueueJob inserts the jobs row and THEN sends the
 * pg-boss message; a process death between the two leaves a row no consumer will ever see, and
 * its own catch cannot run. 30 minutes is far past any healthy queue delay, so a row still
 * `queued` at that age was never delivered rather than merely waiting.
 */
const DEFAULT_QUEUED_OLDER_THAN_MS = 30 * 60_000;
/** Bounded batch: at most this many stuck jobs per run. */
const DEFAULT_LIMIT = 100;
/** Stamped on a reconciled job whose open reserve WAS released (refunded). */
const RECONCILE_ERROR_RELEASED = "reconciled: worker did not finish; reserve released, re-run the tool";
/**
 * Stamped on a reconciled job whose reserve was ALREADY SETTLED and could not be refunded
 * (released=0, alreadySettled>0): the worker crashed in the window between commit_reserve
 * and completeJob, so the charge stood and the work may be lost. Honest wording — this is
 * NOT a "reserve released, re-run" case; it needs a human, not an automatic refund.
 */
const RECONCILE_ERROR_SETTLED =
  "reconciled: worker did not finish but the charge had already settled; work may be incomplete — contact support for review";
/**
 * Stamped on a reconciled job that had NO open reserve at all (released=0, alreadySettled=0):
 * it crashed before any reserve opened, so nothing was released and nothing settled. Honest
 * wording — the "reserve released" clause would be untrue here. The user was never debited, so
 * re-running the tool is still the correct guidance.
 */
const RECONCILE_ERROR_NO_RESERVE =
  "reconciled: worker did not finish; no open reserve to release, re-run the tool";
/**
 * Stamped on a reconciled job whose reserve had ALREADY BEEN REFUNDED before this sweep
 * (released=0, alreadyReleased>0): an earlier sweep — or the guard's own release — put the
 * money back, but the jobs row never flipped out of `running`. release_reserve reports this
 * with the very same "already settled" error it raises for a COMMITTED reserve, so before
 * L-01 this case was stamped with the SETTLED wording and told a user whose credits were
 * already back that a charge stood and to contact support. The money is home; re-running is
 * the correct guidance.
 */
const RECONCILE_ERROR_REFUNDED =
  "reconciled: worker did not finish; the reserve was already refunded, re-run the tool";
/**
 * Stamped on a job that sat `queued` past the queued window (M-01). It was never claimed, so
 * no reserve ever opened and NOTHING was charged — the wording must not mention a refund or a
 * reserve, because neither happened. Re-running is free of any prior debit.
 */
const RECONCILE_ERROR_NEVER_DELIVERED =
  "reconciled: the job was never delivered to a worker; no credits were charged, re-run the tool";

export interface ReconcileOptions {
  /** Reap running jobs whose started_at is older than this (default 15 min). */
  olderThanMs?: number;
  /** Injectable clock — tests pin it. */
  now?: () => Date;
  /** Max jobs processed per run (default 100). */
  limit?: number;
  /** Ledger-lane window: refund open spend_reserve rows older than this (default 30 min). */
  orphanOlderThanMs?: number;
  /** Queued-lane window: fail never-delivered `queued` rows older than this (default 30 min). */
  queuedOlderThanMs?: number;
  /**
   * Restrict BOTH lanes to a single tenant. Reconciliation is a system-level sweep by default
   * (that is what makes it a sweep), but a support ticket is about one user — reconciliation.md
   * §2b already groups the impact per user — and scoping the sweep to them keeps an incident
   * response from touching anyone else's money. It is also what makes the ledger-lane specs
   * deterministic against a shared test database.
   */
  userId?: string;
  /**
   * Opt out of the MIN_OLDER_THAN_MS floor. Only an operator who has decided to accept
   * refunding jobs that may still be running should set this (see UNSAFE_THRESHOLD_FLAG).
   */
  allowUnsafeThreshold?: boolean;
}

/**
 * Validate the staleness window BEFORE anything else happens — in particular before
 * getServiceClient(), so a bad threshold is a pure, DB-free, env-free rejection rather than a
 * sweep that has already started mutating rows. Throws with the offending value named.
 */
function assertSafeThreshold(olderThanMs: number, allowUnsafe: boolean, what: string): void {
  if (!Number.isFinite(olderThanMs) || olderThanMs <= 0) {
    throw new Error(`${what}: the staleness window must be a positive number (got ${olderThanMs}ms)`);
  }
  if (olderThanMs < MIN_OLDER_THAN_MS && !allowUnsafe) {
    throw new Error(
      `${what}: a ${olderThanMs}ms window is below the ${MIN_OLDER_THAN_MS}ms floor` +
        ` — a window shorter than the longest tool runtime reaps LIVE jobs. Pass` +
        ` allowUnsafeThreshold (CLI: ${UNSAFE_THRESHOLD_FLAG}) if that is genuinely intended.`,
    );
  }
}

const OLDER_THAN_FLAG = "--older-than-minutes=";

/** What the reconcile CLI resolved from argv. */
export interface ReconcileArgs {
  readonly olderThanMinutes: number;
  readonly allowUnsafeThreshold: boolean;
}

/**
 * Parse scripts/reconcile.mjs's argv — pure, side-effect free and exported so the rejection
 * rules are unit-testable without a database (L-16). The CLI used to do `Number(...)` plus a
 * `> 0` check inline, which happily accepted `.15` (nine seconds). Every rejection throws;
 * the caller turns that into an exit code.
 */
export function parseReconcileArgs(argv: readonly string[]): ReconcileArgs {
  let olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES;
  let allowUnsafeThreshold = false;
  let raw: string | null = null;

  for (const arg of argv) {
    if (arg === UNSAFE_THRESHOLD_FLAG) {
      allowUnsafeThreshold = true;
    } else if (arg.startsWith(OLDER_THAN_FLAG)) {
      raw = arg.slice(OLDER_THAN_FLAG.length);
    } else {
      throw new Error(`unknown argument: ${arg} (expected ${OLDER_THAN_FLAG}N)`);
    }
  }

  if (raw !== null) {
    // Number("") is 0 and Number(" ") is 0, so an empty value falls into the positive check
    // below rather than silently meaning "reap everything".
    olderThanMinutes = Number(raw);
  }
  // Reuse the ONE floor implementation so the CLI and the library can never drift apart.
  assertSafeThreshold(
    olderThanMinutes * 60_000,
    allowUnsafeThreshold,
    `invalid ${OLDER_THAN_FLAG}${raw ?? olderThanMinutes}`,
  );
  return { olderThanMinutes, allowUnsafeThreshold };
}

export interface ReconcileOutcome {
  readonly scanned: number; // stuck candidates found
  readonly released: number; // reserves refunded
  readonly alreadySettled: number; // reserves settled concurrently (skipped, no double-refund)
  /**
   * The alreadySettled split (L-01). `release_reserve` reports a COMMITTED and an already
   * REFUNDED reserve with one indistinguishable "already settled" error; the ledger is read
   * back to tell them apart. alreadyCommitted counts the standing charges (a human owes the
   * user a decision), alreadyReleased the reserves whose money is already home. An
   * unreadable settlement folds into alreadyCommitted — the conservative bucket — so the
   * invariant alreadyCommitted + alreadyReleased === alreadySettled always holds.
   */
  readonly alreadyCommitted: number;
  readonly alreadyReleased: number;
  readonly failed: number; // jobs transitioned running -> failed
  readonly orphanReserves: number; // open reserves found via ledger.job_id when reserve_id was NULL
  /**
   * The LEDGER lane (H-01). orphanScanned counts open reserves enumerated straight from
   * credit_ledger — no jobs row required and no status consulted — and orphanReleased how many
   * of them the release_reserve RPC actually refunded. orphanAlreadySettled is the narrow race
   * where a reserve settled between the enumeration and the refund; the RPC catches it and no
   * double refund occurs. These are DISJOINT from the jobs-lane counters above: a reserve the
   * jobs lane refunded earlier in the same sweep is already settled and never enumerated here.
   */
  readonly orphanScanned: number;
  readonly orphanReleased: number;
  readonly orphanAlreadySettled: number;
  /** The QUEUED lane (M-01): never-delivered rows found, and how many this run transitioned. */
  readonly queuedScanned: number;
  readonly queuedFailed: number;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every reserve id carrying a spend_reserve row for this job, found by ledger.job_id
 * (NOT jobs.reserve_id). Keying on job_id finds the reserve even in the
 * crash-before-setJobReserve window, when jobs.reserve_id is still NULL but the ledger
 * reserve is already open (the orphan case).
 *
 * Open-vs-settled is deliberately NOT decided here: an app-side "is it open?" read is a
 * TOCTOU race (the reserve can settle between the read and the release). The authoritative
 * open check is release_reserve's own advisory-locked settled-guard, so this only
 * ENUMERATES reserves and lets the RPC be the arbiter.
 */
async function findJobReserves(client: ServiceClient, jobId: string): Promise<string[]> {
  const { data, error } = await client
    .from("credit_ledger")
    .select("reserve_id")
    .eq("job_id", jobId)
    .eq("kind", "spend_reserve");
  if (error) {
    throw new Error(`findJobReserves(${jobId}) failed: ${error.message}`);
  }
  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (row.reserve_id !== null) ids.add(row.reserve_id);
  }
  return [...ids];
}

/** Which ledger row closed a reserve — the two shapes release_reserve reports identically. */
type SettlementKind = "committed" | "released" | "unknown";

/**
 * Read back WHICH row settled `reserveId` (L-01). `release_reserve` raises the same
 * "reserve already settled" for a committed reserve (the charge stands) and for an already
 * refunded one (the money is back); the error alone cannot tell them apart, and the ledger is
 * the only place the difference is recorded.
 *
 * Deliberately read AFTER the RPC has spoken, never before: the advisory-locked
 * release_reserve stays the sole authority on open-vs-settled (the TOCTOU reasoning on
 * findJobReserves above). This read only LABELS a settlement the RPC has already refused to
 * touch, so it can race with nothing. An unreadable answer returns "unknown", and the caller
 * treats unknown as the conservative "committed" shape rather than promising a refund.
 *
 * Not tenant-filtered, like the sibling reads in this module: reconciliation is a system-level
 * sweep across every tenant by construction, and `reserve_id` is a server-minted uuid that
 * never comes from caller input.
 */
async function settlementKind(client: ServiceClient, reserveId: string): Promise<SettlementKind> {
  const { data, error } = await client
    .from("credit_ledger")
    .select("kind")
    .eq("reserve_id", reserveId)
    .in("kind", ["spend_commit", "spend_release"]);
  if (error) {
    console.error(
      `reconcileStuckJobs: settlement lookup for reserve ${reserveId} failed: ${error.message}`,
    );
    return "unknown";
  }
  const kinds = new Set((data ?? []).map((row) => row.kind));
  // 0005 makes the two mutually exclusive, so at most one is present; a commit still wins
  // explicitly — money taken outranks money returned when labelling.
  if (kinds.has("spend_commit")) return "committed";
  if (kinds.has("spend_release")) return "released";
  return "unknown";
}

/**
 * Running rows with a NULL started_at are not a normal state (markJobRunning always
 * stamps started_at). They cannot be aged, so they are never reaped — only surfaced here
 * for manual inspection.
 */
async function warnRunningWithoutStart(client: ServiceClient, limit: number): Promise<void> {
  const { data, error } = await client
    .from("jobs")
    .select("id")
    .eq("status", "running")
    .is("started_at", null)
    .limit(limit);
  if (error) {
    console.error(`reconcileStuckJobs: running-without-started_at probe failed: ${error.message}`);
    return;
  }
  if (data && data.length > 0) {
    const ids = data.map((row) => row.id).join(", ");
    console.warn(
      `reconcileStuckJobs: ${data.length} running job(s) with NULL started_at left for manual inspection: ${ids}`,
    );
  }
}

/** What the ledger lane did. */
interface OrphanSweepOutcome {
  readonly scanned: number;
  readonly released: number;
  readonly alreadySettled: number;
}

/**
 * The LEDGER lane (H-01): refund every open reserve older than `cutoffIso`, keyed ONLY on
 * credit_ledger — no jobs row required, no status consulted. This is the lane that reaches the
 * two shapes nothing else could see: a SYNC surface reserve (no jobs row exists at all) and an
 * async reserve whose job the worker already marked `failed` after a commit failure.
 *
 * MONEY DIRECTION — RELEASE. The reserve debited the user; a commit that never landed means
 * withCredits threw, so the caller never received the result. Refunding is the only direction
 * that leaves a user who received nothing whole. It cannot over-refund a genuinely committed
 * reserve: release_reserve's own advisory-locked settled-guard rejects that with
 * "already settled", which is why this lane can be one-directional and idempotent at once.
 *
 * Two reads, then the RPC. PostgREST has no NOT EXISTS, so the open set is computed app-side
 * as a set difference — deliberately safe, because the app-side answer is only a CANDIDATE
 * list: the authority on open-vs-settled stays release_reserve (the same reasoning as
 * findJobReserves). A reserve that settles between the two reads simply comes back
 * "already settled" and is skipped.
 *
 * Bounded by `limit`, oldest first, with a per-reserve catch so one bad reserve cannot abort
 * the batch.
 */
async function sweepOrphanReserves(
  client: ServiceClient,
  cutoffIso: string,
  limit: number,
  userId?: string,
): Promise<OrphanSweepOutcome> {
  let candidateQuery = client
    .from("credit_ledger")
    .select("reserve_id")
    .eq("kind", "spend_reserve")
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (userId !== undefined) candidateQuery = candidateQuery.eq("user_id", userId);
  const { data, error } = await candidateQuery;
  if (error) {
    throw new Error(`sweepOrphanReserves: candidate query failed: ${error.message}`);
  }
  const reserveIds = [
    ...new Set((data ?? []).flatMap((row) => (row.reserve_id === null ? [] : [row.reserve_id]))),
  ];
  if (reserveIds.length === 0) return { scanned: 0, released: 0, alreadySettled: 0 };

  const settled = await client
    .from("credit_ledger")
    .select("reserve_id")
    .in("reserve_id", reserveIds)
    .in("kind", ["spend_commit", "spend_release"]);
  if (settled.error) {
    throw new Error(`sweepOrphanReserves: settlement query failed: ${settled.error.message}`);
  }
  const closed = new Set((settled.data ?? []).map((row) => row.reserve_id));
  const open = reserveIds.filter((id) => !closed.has(id));

  let released = 0;
  let alreadySettled = 0;
  for (const reserveId of open) {
    try {
      const { error: releaseError } = await client.rpc("release_reserve", {
        p_reserve_id: reserveId,
      });
      if (!releaseError) {
        released++;
        continue;
      }
      const message = releaseError.message ?? "";
      if (message.includes("already settled")) {
        // Settled between the two reads and the RPC — the guard did its job, no double refund.
        alreadySettled++;
      } else {
        throw new Error(`release_reserve failed for ${reserveId}: ${message}`);
      }
    } catch (reserveError) {
      // Per-reserve isolation, mirroring the per-job catch below: leave it for the next sweep.
      console.error(
        `sweepOrphanReserves: skipping reserve ${reserveId}: ${errorDetail(reserveError)}`,
      );
    }
  }
  if (open.length > 0) {
    // Own greppable line — the jobs lane's `reaper sweep:` heartbeat keeps its exact shape.
    console.warn(
      `orphan reserve sweep: openFound=${open.length} released=${released}` +
        ` alreadySettled=${alreadySettled}`,
    );
  }
  return { scanned: open.length, released, alreadySettled };
}

/**
 * The QUEUED lane (M-01): fail rows that were inserted but never delivered to a worker.
 * enqueueJob writes the jobs row first and sends the pg-boss message second, so a process
 * death in between leaves a row no consumer will ever pick up — the send's own catch cannot
 * run, and retryLimit 0 means nothing replays it. Nothing was ever charged on this path (a
 * reserve only opens after the claim), so this lane touches NO money: it only tells the user
 * the truth instead of leaving them watching `queued` forever.
 *
 * Compare-and-set on `status = 'queued'`, so a worker that claims the row in the same instant
 * wins and this update matches 0 rows.
 */
async function sweepStuckQueuedJobs(
  client: ServiceClient,
  cutoffIso: string,
  nowIso: string,
  limit: number,
  userId?: string,
): Promise<{ scanned: number; failed: number }> {
  let query = client
    .from("jobs")
    .select("id")
    .eq("status", "queued")
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (userId !== undefined) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) {
    throw new Error(`sweepStuckQueuedJobs: candidate query failed: ${error.message}`);
  }
  const candidates = data ?? [];

  let failed = 0;
  for (const job of candidates) {
    try {
      const update = await client
        .from("jobs")
        .update({
          status: "failed",
          finished_at: nowIso,
          error: RECONCILE_ERROR_NEVER_DELIVERED,
        })
        .eq("id", job.id)
        .eq("status", "queued")
        .select("id");
      if (update.error) {
        throw new Error(update.error.message);
      }
      if (update.data && update.data.length > 0) failed++;
    } catch (jobError) {
      console.error(`sweepStuckQueuedJobs: skipping job ${job.id}: ${errorDetail(jobError)}`);
    }
  }
  if (failed > 0) {
    console.warn(`stuck queued sweep: scanned=${candidates.length} failed=${failed}`);
  }
  return { scanned: candidates.length, failed };
}

/**
 * Refund the open reserves of crashed jobs and mark those jobs failed. Each job is
 * handled independently (per-job catch): one bad job must never abort the batch.
 */
export async function reconcileStuckJobs(opts?: ReconcileOptions): Promise<ReconcileOutcome> {
  const olderThanMs = opts?.olderThanMs ?? DEFAULT_OLDER_THAN_MS;
  const orphanOlderThanMs = opts?.orphanOlderThanMs ?? DEFAULT_ORPHAN_OLDER_THAN_MS;
  const queuedOlderThanMs = opts?.queuedOlderThanMs ?? DEFAULT_QUEUED_OLDER_THAN_MS;
  const allowUnsafe = opts?.allowUnsafeThreshold ?? false;
  // Guard FIRST — before getServiceClient(), so an unsafe window is rejected without a client,
  // without env, and above all without a single mutating statement (L-16). Both lanes are
  // checked: the ledger lane refunds on ledger evidence alone, so a short window there is at
  // least as dangerous as one on the jobs lane.
  assertSafeThreshold(olderThanMs, allowUnsafe, "reconcileStuckJobs");
  assertSafeThreshold(orphanOlderThanMs, allowUnsafe, "reconcileStuckJobs orphanOlderThanMs");
  assertSafeThreshold(queuedOlderThanMs, allowUnsafe, "reconcileStuckJobs queuedOlderThanMs");

  const client = getServiceClient();
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const userId = opts?.userId;
  const now = opts?.now ?? (() => new Date());
  const nowDate = now();
  const cutoffIso = new Date(nowDate.getTime() - olderThanMs).toISOString();

  await warnRunningWithoutStart(client, limit);

  let candidateQuery = client
    .from("jobs")
    .select("id, reserve_id")
    .eq("status", "running")
    .not("started_at", "is", null)
    .lt("started_at", cutoffIso)
    .order("started_at", { ascending: true })
    .limit(limit);
  if (userId !== undefined) candidateQuery = candidateQuery.eq("user_id", userId);
  const { data, error } = await candidateQuery;
  if (error) {
    throw new Error(`reconcileStuckJobs: candidate query failed: ${error.message}`);
  }
  const candidates = data ?? [];

  let released = 0;
  let alreadySettled = 0;
  let alreadyCommitted = 0;
  let alreadyReleased = 0;
  let failed = 0;
  let orphanReserves = 0;

  for (const job of candidates) {
    try {
      const reserveWasNull = job.reserve_id === null;
      // Per-job tally (for the honest fail-mark string below); the global counters keep
      // their existing semantics untouched.
      let jobReleased = 0;
      let jobAlreadyCommitted = 0;
      let jobAlreadyReleased = 0;

      // Release FIRST, then conditional-fail. Rationale: if we failed the job first and
      // the real worker then committed, we would have a job that is BOTH failed AND
      // charged. Releasing first means a worker's later commit hits "already settled" and
      // its own catch fails the job — a single, refunded, consistent outcome.
      for (const reserveId of await findJobReserves(client, job.id)) {
        const { error: releaseError } = await client.rpc("release_reserve", {
          p_reserve_id: reserveId,
        });
        if (!releaseError) {
          released++;
          jobReleased++;
          if (reserveWasNull) orphanReserves++; // an open reserve found only via job_id
          continue;
        }
        const message = releaseError.message ?? "";
        if (message.includes("already settled")) {
          // The real worker committed/released concurrently under the advisory lock — the
          // settlement stands; re-releasing would double-refund. Skip. WHICH settlement it
          // was decides the user-facing wording, so read the ledger back (L-01): "committed"
          // means the charge stands, "released" means the money is already home. An
          // unreadable answer folds into the conservative committed bucket, keeping
          // alreadyCommitted + alreadyReleased === alreadySettled.
          alreadySettled++;
          if ((await settlementKind(client, reserveId)) === "released") {
            alreadyReleased++;
            jobAlreadyReleased++;
          } else {
            alreadyCommitted++;
            jobAlreadyCommitted++;
          }
        } else if (message.includes("unknown reserve")) {
          // No spend_reserve row for this id — a data anomaly, nothing to refund.
          console.warn(`reconcileStuckJobs: unknown reserve ${reserveId} on job ${job.id}; nothing to refund`);
        } else {
          // Unexpected (e.g. a DB outage). Skip THIS job WITHOUT failing it — never mark a
          // job failed on an unconfirmed release, and never cascade one job's DB error
          // across the batch. The open reserve is left for the next run.
          throw new Error(`release_reserve failed for ${reserveId}: ${message}`);
        }
      }

      // Honest fail-mark, four-way — the stamped wording must match what actually happened:
      //  - a refund happened here (released>0)              → RELEASED ("reserve released, re-run")
      //  - a reserve was already COMMITTED                  → SETTLED  (charged; needs a human)
      //  - a reserve was already RELEASED (L-01)            → REFUNDED (money home; re-run)
      //  - no reserve at all (crashed before any opened)    → NO_RESERVE (nothing to release, re-run)
      // The settled shape must NOT claim a refund; the refunded shape must NOT send a user
      // whose money is already back to support; the no-reserve shape must NOT claim a
      // "reserve released" that never occurred. Money direction is untouched — this only
      // selects the fail-mark string. Committed is checked FIRST: a standing charge is the
      // outcome a human must see even in the (index-prevented) event of a mixed job.
      const reconcileError =
        jobReleased > 0
          ? RECONCILE_ERROR_RELEASED
          : jobAlreadyCommitted > 0
            ? RECONCILE_ERROR_SETTLED
            : jobAlreadyReleased > 0
              ? RECONCILE_ERROR_REFUNDED
              : RECONCILE_ERROR_NO_RESERVE;

      // Conditional fail: flip to failed ONLY while the row is still `running`. The status
      // guard prevents clobbering a job the real worker completed concurrently (that job
      // is already succeeded/failed, so this update matches 0 rows and is a no-op).
      const failUpdate = await client
        .from("jobs")
        .update({ status: "failed", finished_at: nowDate.toISOString(), error: reconcileError })
        .eq("id", job.id)
        .eq("status", "running")
        .select("id");
      if (failUpdate.error) {
        throw new Error(`reconcileStuckJobs: fail update on job ${job.id} failed: ${failUpdate.error.message}`);
      }
      if (failUpdate.data && failUpdate.data.length > 0) failed++;
    } catch (jobError) {
      // Per-job isolation: one bad job must never abort the batch.
      console.error(`reconcileStuckJobs: skipping job ${job.id}: ${errorDetail(jobError)}`);
    }
  }

  // The ledger lane runs LAST on purpose: every reserve the jobs lane just refunded is now
  // settled, so it is filtered out below and this lane only sees what nothing else could reach.
  const orphan = await sweepOrphanReserves(
    client,
    new Date(nowDate.getTime() - orphanOlderThanMs).toISOString(),
    limit,
    userId,
  );

  // The queued lane touches no money, so it runs last and cannot affect anything above it.
  const queued = await sweepStuckQueuedJobs(
    client,
    new Date(nowDate.getTime() - queuedOlderThanMs).toISOString(),
    nowDate.toISOString(),
    limit,
    userId,
  );

  return {
    scanned: candidates.length,
    released,
    alreadySettled,
    alreadyCommitted,
    alreadyReleased,
    failed,
    orphanReserves,
    orphanScanned: orphan.scanned,
    orphanReleased: orphan.released,
    orphanAlreadySettled: orphan.alreadySettled,
    queuedScanned: queued.scanned,
    queuedFailed: queued.failed,
  };
}
