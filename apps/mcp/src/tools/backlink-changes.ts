import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  BACKLINK_CHANGES_GROUP_RANGES,
  BACKLINK_CHANGES_RANK_MAX,
  DEFAULT_BACKLINK_CHANGES_GROUP_RANGE,
  DEFAULT_BACKLINK_CHANGES_PERIODS,
  MAX_BACKLINK_CHANGES_PERIODS,
  NEW_LOST_DEFINITION,
  resolveDefaultBacklinkChangesPort,
  type BacklinkChangePoint,
  type BacklinkChangesPort,
  type BacklinkChangesResult,
  type BacklinkProfilePoint,
} from "../dfs/backlink-changes.ts";
import {
  backlinkChangesRunReport,
  writeDomainLookupRun,
  type DomainLookupRunWriter,
} from "../dfs/runs.ts";
import { bucketDateLabel, exactCount } from "../format/quantities.ts";
import {
  loadOwnProject,
  projectIdField,
  resolveTarget,
  subjectLabel,
  targetField,
  type LoadProjectFn,
  type ProjectRef,
} from "./project-target.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * backlink_changes — what happened to a site's backlink profile over time, from DataForSEO's two
 * Backlinks time-series endpoints (see dfs/backlink-changes.ts, which explains why one lookup is
 * two requests and why the two series are never merged). Synchronous: the series come back
 * immediately (no background job). It takes EITHER a bare `target` (any public domain) OR a
 * `project_id`, whose stored domain becomes the target.
 *
 * The same credit path and the same two hard product rules as link_gap and keyword_gap:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear English
 *      error and NEVER serves sample/placeholder figures as if they were real (NEVER #7).
 *   2. That live-disabled error — and every invalid-input rejection — is returned BEFORE any
 *      credit reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler": a SYNCHRONOUS tool that must run logic BEFORE the reserve, which
 * charge:"surface" (reserve-then-handler) cannot express. It settles via withCredits WITHOUT a
 * jobId — the exact SURFACE ledger shape (reserve -> commit, a traceability uuid, no jobs row).
 * One lookup is charged ONCE; if either vendor request fails, withCredits releases and nothing is
 * billed.
 */

const NOT_ENABLED_MESSAGE =
  "Backlink change history is not yet enabled on this deployment. Live DataForSEO data is turned " +
  "off, and SeoGrep never returns sample or placeholder figures as if they were real. This tool " +
  "will start returning data once live DataForSEO access is switched on — you were not charged.";

const inputSchema = z.object({
  target: targetField("read backlink history for"),
  project_id: projectIdField,
  group_range: z
    .enum(BACKLINK_CHANGES_GROUP_RANGES)
    .default(DEFAULT_BACKLINK_CHANGES_GROUP_RANGE)
    .describe(
      "How the history is bucketed: day, week, month or year (default " +
        `${DEFAULT_BACKLINK_CHANGES_GROUP_RANGE}). DataForSEO rounds the window out to whole ` +
        "weeks/months/years, so you may get one bucket more than you asked for.",
    ),
  periods: z
    .number()
    .int()
    .min(1)
    .max(MAX_BACKLINK_CHANGES_PERIODS)
    .default(DEFAULT_BACKLINK_CHANGES_PERIODS)
    .describe(
      `How many group_range periods back from today to cover (1-${MAX_BACKLINK_CHANGES_PERIODS}, ` +
        `default ${DEFAULT_BACKLINK_CHANGES_PERIODS}). DataForSEO holds no backlink history ` +
        "before 2019-01-30, so a longer window simply starts there.",
    ),
});

type BacklinkChangesInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "See how a site's backlink profile changed over time: new and lost backlinks and referring " +
  "domains per bucket, plus the profile's own totals and DataForSEO rank at each bucket. Pass a " +
  "target domain (any public domain) or a project_id, and choose day/week/month/year buckets. " +
  `Synchronous — returns both series immediately. Costs ${TOOL_COSTS.backlink_changes} credits. ` +
  "Needs a paid credit balance: it is not available on trial credits. If live DataForSEO access " +
  "is unavailable on this deployment, the tool says so and charges nothing.";

/**
 * A metric value: a grouped number, or an honest "n/a" when DataForSEO had none.
 *
 * EVERY FIGURE THIS TOOL PRINTS IS A COUNT — backlinks, referring domains, and a rank on a fixed
 * integer scale. None of them is a model estimate, so none of them is rounded to a coarser unit:
 * `exactCount` groups the digits and drops nothing (format/quantities.ts, class 1).
 *
 * ZERO IS NOT ABSENCE HERE, in either direction. DataForSEO documents that it returns 0 for a
 * bucket it has no data for, so a printed 0 is the vendor's own answer and is printed as 0; a
 * field that is MISSING is the vendor declining to say, and becomes n/a. Rendering the second
 * case as 0 would turn "we don't know" into "nothing happened" (NEVER #7).
 */
function metric(value: number | null): string {
  return value === null ? "n/a" : exactCount(value);
}

/** The window the VENDOR says it answered for, or an honest admission that it did not say. */
function windowClause(changes: BacklinkChangesResult): string {
  if (changes.date_from === null || changes.date_to === null) {
    return "over the window DataForSEO answered for (it did not name the dates)";
  }
  return `from ${changes.date_from} to ${changes.date_to}`;
}

/**
 * The heading: whose history, how it is bucketed, and over which window — all vendor-stated.
 *
 * It names NO bucket count. The two endpoints are answered independently and can come back with
 * different numbers of buckets, so a single count in the heading would be a claim about both
 * series drawn from one of them — a small version of the conflation this whole tool exists to
 * avoid. Each section states its own count instead (sectionHeading).
 *
 * A mutation found this: replacing a `Math.max` over the two lengths with just one of them
 * changed nothing, because no spec varied the two lengths against each other. The hole was in the
 * design, not only in the coverage, so the count moved to where it is unambiguous.
 */
export function renderBacklinkChangesHeader(
  changes: BacklinkChangesResult,
  project?: ProjectRef | null,
): string {
  const subject = subjectLabel(changes.target, project);
  return (
    `Backlink history for ${subject} — ${changes.group_range} buckets ` +
    `${windowClause(changes)}, as DataForSEO grouped them:`
  );
}

/** A section heading that owns its OWN bucket count, because the two series can disagree. */
export function sectionHeading(label: string, count: number, groupRange: string): string {
  return `${label} — ${exactCount(count)} ${groupRange} bucket${count === 1 ? "" : "s"}`;
}

/**
 * One bucket of the new/lost series.
 *
 * THE BUCKET LABEL IS THE VENDOR'S STORED DATE WITH A ZERO CLOCK DROPPED. DataForSEO labels every
 * bucket "2025-08-31 00:00:00 +00:00", and a default lookup printed those eleven identical,
 * information-free characters 26 times in one answer, pushing the dates a reader came for into the
 * noise. Only a provably-zero UTC clock is dropped and nothing is re-labelled — see
 * {@link bucketDateLabel} for the narrow condition and for why a real time of day survives.
 */
export function renderChangePoint(point: BacklinkChangePoint, partial = false): string {
  return (
    `• ${bucketDateLabel(point.date)} — ${metric(point.new_backlinks)} new / ` +
    `${metric(point.lost_backlinks)} lost backlinks · ` +
    `${metric(point.new_referring_domains)} new / ` +
    `${metric(point.lost_referring_domains)} lost referring domains` +
    (partial ? PARTIAL_BUCKET_MARKER : "")
  );
}

/** One bucket of the profile series, labelled by the same rule as the new/lost series. */
export function renderProfilePoint(point: BacklinkProfilePoint, partial = false): string {
  return (
    `• ${bucketDateLabel(point.date)} — ${metric(point.backlinks)} backlinks · ` +
    `${metric(point.referring_domains)} referring domains · ` +
    `rank ${metric(point.rank)} of ${exactCount(BACKLINK_CHANGES_RANK_MAX)}` +
    (partial ? PARTIAL_BUCKET_MARKER : "")
  );
}

/**
 * =============================================================================================
 * THE THIRD MEANING OF A PRINTED ZERO — a bucket whose period has not happened yet (B-4)
 * =============================================================================================
 * This tool already distinguishes two meanings of an empty cell: the vendor's own `0`, which is
 * a measurement and prints as `0`, and a MISSING field, which is the vendor declining to say and
 * prints as `n/a` (see {@link metric}). MEASURED 2026-09-04, in BOTH live calls of that round
 * and run on 2026-09-03: DataForSEO closed each series with a bucket labelled with the period's
 * END date — `2026-09-30` monthly, `2026-09-06` weekly — carrying `0 new / 0 lost`, with the
 * profile line repeating the previous bucket's totals verbatim. Those are the vendor's honest
 * figures for a period that has not finished, and read as "the site stopped gaining links".
 *
 * NOTHING IS REMOVED. The vendor's bucket, its label and its figures all still print — deleting
 * or rewriting a vendor row is what NEVER #7 forbids. The line gets a marker and the answer gets
 * one sentence.
 *
 * WHY STRICTLY AFTER TODAY, and not "today or later": a label equal to today is genuinely
 * ambiguous (a daily bucket for today is unfinished; a monthly bucket labelled on the last day
 * of the month is only unfinished until midnight), and this module cannot tell which without
 * knowing the vendor's own cut-off. A label in the FUTURE is unambiguous on any reading, so that
 * is the only case claimed. Erring here costs an unmarked line; erring the other way would put a
 * claim on a bucket that may well be complete.
 */
export const PARTIAL_BUCKET_MARKER = " — PARTIAL: this period has not ended yet";

/** The one sentence that says what {@link PARTIAL_BUCKET_MARKER} means. Printed at most once. */
export const PARTIAL_BUCKET_NOTE =
  "One or more buckets above are labelled with a date in the future, which means the period they " +
  "cover has not finished. DataForSEO still returns a row for such a bucket, and its figures are " +
  "the ones it has so far — a 0 there is not a measurement of the whole period, and a profile " +
  "line that repeats the previous bucket is not evidence that nothing changed. Compare complete " +
  "buckets with complete buckets.";

/**
 * Whether a bucket's vendor label names a date strictly after `today`, in UTC.
 *
 * The label is read with its own regex rather than through `Date` parsing: an unrecognised label
 * must mean "cannot tell", not "epoch", and a `NaN` date silently compares false to everything.
 * The comparison is on the `yyyy-mm-dd` text, which sorts chronologically by construction.
 */
function isUnfinishedBucket(vendorDate: string, today: Date): boolean {
  const day = /^(\d{4}-\d{2}-\d{2})\b/.exec(vendorDate)?.[1];
  return day !== undefined && day > today.toISOString().slice(0, 10);
}

/**
 * The sentence that stops a reader doing arithmetic across the two sections.
 *
 * It is printed whenever both series are present, and it is not a hedge: DataForSEO's own
 * published examples for the two endpoints disagree on the same target and window (see the module
 * header of dfs/backlink-changes.ts). The tool therefore prints both measurements and refuses to
 * derive a third one from them — subtracting lost from new and captioning it with the profile
 * total would be a reconciliation the vendor never made (NEVER #7).
 */
export const SERIES_DO_NOT_RECONCILE_NOTE =
  "These are two separate DataForSEO measurements, counted against different definitions: the " +
  "new/lost series counts arrivals and departures, and the profile series is a snapshot of the " +
  "totals. Subtracting one from the other does not reproduce the other, so SeoGrep does not " +
  "print a combined figure.";

/** The "nothing at all" answer — a real, delivered result rather than an error. */
function renderNoHistory(changes: BacklinkChangesResult, project?: ProjectRef | null): string {
  const subject = subjectLabel(changes.target, project);
  return (
    `No backlink history found for ${subject}: DataForSEO returned no ${changes.group_range} ` +
    `bucket ${windowClause(changes)}.`
  );
}

/**
 * Render the two series as the plain-text tool output (pure — unit-tested directly).
 *
 * `today` is a parameter rather than a call to the clock inside the renderer, so the unfinished-
 * bucket rule (B-4) is a spec about the rule and not about the day the suite runs. Production
 * passes nothing and gets the real now.
 */
export function formatBacklinkChanges(
  changes: BacklinkChangesResult,
  project?: ProjectRef | null,
  today: Date = new Date(),
): string {
  if (changes.changes.length === 0 && changes.profile.length === 0) {
    return renderNoHistory(changes, project);
  }
  const unfinished = (point: { readonly date: string }): boolean =>
    isUnfinishedBucket(point.date, today);
  const blocks = [renderBacklinkChangesHeader(changes, project)];
  if (changes.changes.length > 0) {
    blocks.push(
      `${sectionHeading("New and lost", changes.changes.length, changes.group_range)}. ` +
        `${NEW_LOST_DEFINITION}:`,
      changes.changes.map((point) => renderChangePoint(point, unfinished(point))).join("\n"),
    );
  }
  if (changes.profile.length > 0) {
    blocks.push(
      `${sectionHeading("Profile at each bucket", changes.profile.length, changes.group_range)}:`,
      changes.profile.map((point) => renderProfilePoint(point, unfinished(point))).join("\n"),
    );
  }
  if (changes.changes.some(unfinished) || changes.profile.some(unfinished)) {
    blocks.push(PARTIAL_BUCKET_NOTE);
  }
  if (changes.changes.length > 0 && changes.profile.length > 0) {
    blocks.push(SERIES_DO_NOT_RECONCILE_NOTE);
  }
  return blocks.join("\n\n");
}

/** Dependencies — the port is injectable so tests run offline (mock/disabled). */
export interface BacklinkChangesDeps {
  /**
   * The backlink-changes port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: BacklinkChangesPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The run recorder (default: the real `writeDomainLookupRun`, migration 0031). A PORT for the
   * reason every other writer in this family is one: a spec can make it FAIL without breaking a
   * database, which is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: DomainLookupRunWriter;
}

export function makeBacklinkChangesTool(deps: BacklinkChangesDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeDomainLookupRun;
  return defineTool<BacklinkChangesInput>({
    name: "backlink_changes",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve WHOSE history this is: exactly one of project_id /
      // target, the project read tenant-scoped, the domain canonicalized by the shared normalizer.
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      const port = deps.port ?? resolveDefaultBacklinkChangesPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve mock data.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch -> commit
      // as one chain. Either DataForSEO request failing throws, so withCredits releases.
      // WHICH PROJECT THE SPEND IS FOR, on the ledger row itself (migration 0033) — the
      // ownership-gated project resolved above. charge:"handler" settles its own credits, so
      // nothing upstream can supply this; undefined on a bare-target call is a REAL answer
      // ("no project scope"), never a gap (credits/guard.ts).
      const meta = { tool: "backlink_changes", projectId: subject.project?.id } as const;
      return withCredits({ userId: ctx.userId }, meta, async () => {
        const changes = await port.fetchBacklinkChanges({
          target: subject.domain,
          group_range: input.group_range,
          periods: input.periods,
        });
        const text = formatBacklinkChanges(changes, subject.project);
        // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT guarded
        // (migration 0031; dfs/runs.ts states the same contract from the other side). withCredits
        // COMMITS a handler that returns and RELEASES one that throws, so an error escaping here
        // costs the tenant nothing. Caught and logged instead, the shape would be the house's
        // worst: a charged caller, a delivered table, and a panel that says forever that the
        // lookup never ran.
        //
        // `projectId` is null on a bare-target call. `target` is the RESOLVED domain, never the
        // caller's raw input: it is what was actually looked up, and for a project run it is what
        // the project's domain was AT THE TIME.
        await writeRun(
          {
            userId: ctx.userId,
            projectId: subject.project?.id ?? null,
            tool: "backlink_changes",
            target: subject.domain,
          },
          backlinkChangesRunReport(changes, { periods: input.periods }),
        );
        return textResult(text);
      });
    },
  });
}

/** The production backlink_changes tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const backlinkChangesTool = makeBacklinkChangesTool();
