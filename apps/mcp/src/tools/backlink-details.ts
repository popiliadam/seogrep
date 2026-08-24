import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  BACKLINK_DETAILS_RANK_MAX,
  DEFAULT_BACKLINK_DETAIL_ROWS,
  DEFAULT_TARGET_PAGE_ROWS,
  MAX_BACKLINK_DETAIL_ROWS,
  MAX_BACKLINKS_OFFSET,
  MAX_TARGET_PAGE_ROWS,
  resolveDefaultBacklinkDetailsPort,
  type BacklinkDetailRow,
  type BacklinkDetails,
  type BacklinkDetailsPort,
  type TargetPageRow,
  type VendorWindow,
} from "../dfs/backlink-details.ts";
import {
  backlinkDetailsRunReport,
  writeDomainLookupRun,
  type DomainLookupRunWriter,
} from "../dfs/runs.ts";
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
 * backlink_details — the ROWS underneath a backlink profile: the individual links (who links,
 * from which page, to WHICH of the target's pages, with what anchor) and the target's own pages
 * ranked by the links they earned. Two DataForSEO Backlinks requests per call, described in
 * dfs/backlink-details.ts. Synchronous: both lists come back immediately, no background job. It
 * takes EITHER a bare `target` (any public domain) OR a `project_id`, whose stored domain becomes
 * the target — the same pair every other domain tool takes.
 *
 * Same credit path and the same two hard product rules as link_gap and backlink_changes:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear English
 *      error and NEVER serves sample/placeholder rows as if they were real (NEVER #7).
 *   2. That live-disabled error — and every invalid-input rejection — is returned BEFORE any
 *      credit reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler": a SYNCHRONOUS tool that must run logic BEFORE the reserve, which
 * charge:"surface" (reserve-then-handler) cannot express. It settles via withCredits WITHOUT a
 * jobId — the exact SURFACE ledger shape (reserve -> commit, a traceability uuid, no jobs row).
 * One lookup is charged ONCE; if either vendor request fails, withCredits releases and nothing is
 * billed.
 *
 * =====================================================================================
 * THE RENDERING PROBLEM THIS FORMATTER EXISTS TO SOLVE
 * =====================================================================================
 * What comes back is a WINDOW, and the vendor's own example proves how far a window can sit from
 * the set it was cut out of: 2 fetched rows against a `total_count` of 42,671,699. A caption that
 * printed those two numbers together as "2 of 42,671,699 backlinks" would read as "here are the
 * first two of a list that continues" — which is false the moment `offset` is anything but 0, and
 * misleading even at 0, because nothing was measured about the other 42 million rows.
 *
 * So every count printed here NAMES THE SET IT COUNTS, and the two sets are never joined by an
 * "of":
 *   • the window count says "in this window", and the window's OWN bounds — the offset and the
 *     limit it was fetched under — are printed beside it, so the reader can see which slice they
 *     are holding;
 *   • the whole-set count is attributed to the vendor by name ("DataForSEO counts N … for this
 *     target in total") and followed by the sentence that stops the arithmetic:
 *     "this window is a slice of that set, not a count of it".
 * A `null` whole-set count is rendered as the vendor DECLINING TO SAY, never as 0 and never
 * back-filled from the rows in hand (signed lesson 12: an absent figure printed as a number is a
 * fabricated measurement). renderWindowCaption is the single place either number is formatted, so
 * the two cannot drift apart, and backlink-details.test.ts pins BOTH directions — the wording
 * that must appear and the "N of M" phrasing that must not.
 * =====================================================================================
 *
 * LINK-QUALITY JUDGEMENT: none. The two spam scores are DataForSEO's own fields printed under the
 * vendor's own names (`backlink_spam_score` on a link, `backlinks_spam_score` on a page — the
 * vendor really does spell them differently), and the output says whose numbers they are. SeoGrep
 * derives no "toxic", "bad link" or "disavow" verdict from them.
 */

const NOT_ENABLED_MESSAGE =
  "Backlink details are not yet enabled on this deployment. Live DataForSEO data is turned off, " +
  "and SeoGrep never returns sample or placeholder rows as if they were real. This tool will " +
  "start returning data once live DataForSEO access is switched on — you were not charged.";

const inputSchema = z.object({
  target: targetField("list individual backlinks for"),
  project_id: projectIdField,
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_BACKLINK_DETAIL_ROWS)
    .default(DEFAULT_BACKLINK_DETAIL_ROWS)
    .describe(
      `How many individual backlinks to return (1-${MAX_BACKLINK_DETAIL_ROWS}, default ` +
        `${DEFAULT_BACKLINK_DETAIL_ROWS}). DataForSEO bills per returned row, so this is the ` +
        "price control, not a display preference.",
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .max(MAX_BACKLINKS_OFFSET)
    .default(0)
    .describe(
      `How many backlinks to skip before the window starts (0-${MAX_BACKLINKS_OFFSET}, default ` +
        "0). Page through a large profile by advancing this; the output always states the offset " +
        "and limit the rows were fetched under.",
    ),
  page_limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_TARGET_PAGE_ROWS)
    .default(DEFAULT_TARGET_PAGE_ROWS)
    .describe(
      `How many of the target's OWN pages to return, most-linked first (1-` +
        `${MAX_TARGET_PAGE_ROWS}, default ${DEFAULT_TARGET_PAGE_ROWS}). Billed per row on the ` +
        "same tariff as the backlink list.",
    ),
});

type BacklinkDetailsInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "List a site's individual backlinks — who links, from which page, to which page of the site, " +
  "with what anchor — plus the site's own pages ranked by the links they earned. Pass a target " +
  "domain (any public domain) or a project_id, and page through the link list with limit and " +
  `offset. Synchronous — returns both lists immediately. Costs ${TOOL_COSTS.backlink_details} ` +
  "credits. Needs a paid credit balance: it is not available on trial credits. If live " +
  "DataForSEO access is unavailable on this deployment, the tool says so and charges nothing.";

/** Group digits with commas without depending on ICU/locale data (deterministic). */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A metric value: a grouped number, or an honest "n/a" when DataForSEO had none.
 *
 * A vendor ZERO is the vendor's own answer and prints as 0; a MISSING field is the vendor
 * declining to say and prints as n/a. On a backlink report the difference is news either way —
 * "0 broken backlinks" is a clean bill of health, and inventing one is exactly what signed
 * lesson 12 is about.
 */
function metric(value: number | null): string {
  return value === null ? "n/a" : thousands(value);
}

/** A URL the vendor may not have named. Absent is said out loud, never rendered as an empty gap. */
function urlOrUnnamed(url: string | null): string {
  return url ?? "(DataForSEO did not name it)";
}

/**
 * THE CAPTION. Two counts, two sets, never joined.
 *
 * See the module header. This is the ONLY place a row count or a whole-set count is formatted, so
 * a future edit cannot introduce a second, friendlier phrasing beside this one.
 */
export function renderWindowCaption(
  label: string,
  noun: string,
  window: VendorWindow<unknown>,
): string {
  const rows = window.window_row_count;
  const plural = `${noun}s`;
  const shown =
    `${label} — ${thousands(rows)} ${rows === 1 ? noun : plural} in this window ` +
    `(offset ${thousands(window.window_offset)}, limit ${thousands(window.window_limit)})`;
  // `null` is the vendor DECLINING TO SAY. It is not 0, and it is not rows.length: either
  // substitution would publish a measurement of the whole set that nobody made.
  const whole =
    window.vendor_total_count === null
      ? `DataForSEO did not say how many ${plural} exist for this target in total`
      : `DataForSEO counts ${thousands(window.vendor_total_count)} ${plural} for this target in total`;
  return `${shown}. ${whole} — this window is a slice of that set, not a count of it:`;
}

/** Whether a link is followed, or an honest admission that DataForSEO did not say. */
function followClause(dofollow: boolean | null): string {
  if (dofollow === null) return "follow status n/a";
  return dofollow ? "dofollow" : "nofollow";
}

/**
 * The anchor, or WHY there is none. The port renders a missing anchor as "" (the vendor sends
 * null on image links), and `item_type` is the vendor's own explanation — printing it beside the
 * blank keeps "no anchor text" from reading as a defect in the lookup.
 */
function anchorClause(row: BacklinkDetailRow): string {
  if (row.anchor !== "") return `anchor "${row.anchor}"`;
  return row.item_type === null ? "no anchor text" : `no anchor text (${row.item_type} link)`;
}

/** One backlink: where it comes from on the first line, what it is on the second. */
export function renderBacklinkRow(row: BacklinkDetailRow): string {
  const broken = row.is_broken === true ? " · DataForSEO flags this link as broken" : "";
  return (
    `• ${row.domain_from} → ${urlOrUnnamed(row.url_to)}\n` +
    `  from ${urlOrUnnamed(row.url_from)} · ${anchorClause(row)} · ${followClause(row.dofollow)} · ` +
    `rank ${metric(row.rank)} of ${thousands(BACKLINK_DETAILS_RANK_MAX)} · ` +
    `vendor spam score ${metric(row.backlink_spam_score)} · ` +
    `linked page status ${metric(row.url_to_status_code)} · ` +
    `first seen ${row.first_seen ?? "n/a"} · last seen ${row.last_seen ?? "n/a"}${broken}`
  );
}

/** One page OF THE TARGET, with the vendor's counts for it. */
export function renderTargetPageRow(row: TargetPageRow): string {
  const lost = row.lost_date === null ? "" : ` · lost ${row.lost_date}`;
  return (
    `• ${row.url}\n` +
    `  ${metric(row.backlinks)} backlinks · ${metric(row.referring_domains)} referring domains ` +
    `(${metric(row.referring_domains_nofollow)} nofollow) · ` +
    `${metric(row.broken_backlinks)} broken backlinks · ` +
    `rank ${metric(row.rank)} of ${thousands(BACKLINK_DETAILS_RANK_MAX)} · ` +
    `vendor spam score ${metric(row.backlinks_spam_score)} · ` +
    `first seen ${row.first_seen ?? "n/a"}${lost}`
  );
}

/**
 * Whose numbers the spam scores are. Printed whenever any row is printed, because a bare column
 * headed "spam score" beside a list of links reads as SeoGrep's own verdict on those links — and
 * this tool does not have one (NEVER #7). It also names the vendor's two different spellings, so
 * a reader comparing a link's score with a page's score knows they are different measurements on
 * different objects rather than the same number rendered twice.
 */
export const VENDOR_SPAM_SCORE_NOTE =
  "The spam scores above are DataForSEO's own fields, printed under the vendor's own names: " +
  "backlink_spam_score for one link, backlinks_spam_score for one page. They are two different " +
  "measurements on two different objects. SeoGrep adds no link-quality verdict of its own and " +
  "does not tell you to disavow anything.";

/** The "nothing at all" answer — a real, delivered result rather than an error. */
function renderNothingFound(details: BacklinkDetails, project?: ProjectRef | null): string {
  const subject = subjectLabel(details.target, project);
  const { window_offset: offset, window_limit: limit } = details.links;
  return (
    `No backlinks found for ${subject}: DataForSEO returned no link row and no page row for the ` +
    `window that was asked for (offset ${thousands(offset)}, limit ${thousands(limit)}).`
  );
}

/** Render one lookup as the plain-text tool output (pure — unit-tested directly). */
export function formatBacklinkDetails(
  details: BacklinkDetails,
  project?: ProjectRef | null,
): string {
  const links = details.links.rows;
  const pages = details.target_pages.rows;
  if (links.length === 0 && pages.length === 0) {
    return renderNothingFound(details, project);
  }
  const subject = subjectLabel(details.target, project);
  const blocks = [
    `Backlinks for ${subject} — the individual links, and the pages of this site they point at:`,
  ];
  if (links.length > 0) {
    blocks.push(
      renderWindowCaption("Individual backlinks", "backlink", details.links),
      links.map(renderBacklinkRow).join("\n"),
    );
  }
  if (pages.length > 0) {
    blocks.push(
      renderWindowCaption("Pages of this site that earn the links", "page", details.target_pages),
      pages.map(renderTargetPageRow).join("\n"),
    );
  }
  blocks.push(VENDOR_SPAM_SCORE_NOTE);
  return blocks.join("\n\n");
}

/** Dependencies — the port is injectable so tests run offline (mock/disabled). */
export interface BacklinkDetailsDeps {
  /**
   * The backlink-details port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: BacklinkDetailsPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The run recorder (default: the real `writeDomainLookupRun`, migration 0031). A PORT for the
   * reason every other writer in this family is one: a spec can make it FAIL without breaking a
   * database, which is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: DomainLookupRunWriter;
}

export function makeBacklinkDetailsTool(deps: BacklinkDetailsDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeDomainLookupRun;
  return defineTool<BacklinkDetailsInput>({
    name: "backlink_details",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve WHOSE backlinks these are: exactly one of project_id /
      // target, the project read tenant-scoped, the domain canonicalized by the shared normalizer.
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      const port = deps.port ?? resolveDefaultBacklinkDetailsPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve mock rows.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch -> commit
      // as one chain. Either DataForSEO request failing throws, so withCredits releases.
      return withCredits({ userId: ctx.userId }, { tool: "backlink_details" }, async () => {
        const details = await port.fetchBacklinkDetails({
          target: subject.domain,
          limit: input.limit,
          offset: input.offset,
          page_limit: input.page_limit,
        });
        const text = formatBacklinkDetails(details, subject.project);
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
            tool: "backlink_details",
            target: subject.domain,
          },
          backlinkDetailsRunReport(details, {
            limit: input.limit,
            offset: input.offset,
            page_limit: input.page_limit,
          }),
        );
        return textResult(text);
      });
    },
  });
}

/** The production backlink_details tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const backlinkDetailsTool = makeBacklinkDetailsTool();
