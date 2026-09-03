import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { renderOutputLimitNote, renderWithinBudget } from "../format/output-budget.ts";
import {
  BACKLINKS_MAX_LIMIT,
  BACKLINK_RANK_MAX,
  resolveDefaultBacklinksPort,
  type AnchorRow,
  type BacklinkList,
  type BacklinkProfile,
  type BacklinkSummary,
  type BacklinksPort,
  type ReferringDomainRow,
} from "../dfs/backlinks.ts";
import {
  backlinksRunReport,
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
 * analyze_backlinks — a domain's backlink profile from the DataForSEO Backlinks API: the
 * profile-level summary, the top referring domains, and the top anchor texts. Synchronous: it
 * returns the report immediately (no background job). It takes EITHER a bare `target` (any
 * public domain, yours or a competitor's) OR a `project_id`, whose stored domain becomes the
 * target.
 *
 * It is built to the ranked_keywords pattern, and the same two hard product rules shape its
 * credit path:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear
 *      English error and NEVER serves sample/placeholder figures as if they were real
 *      (constitution NEVER #7). The mock fixtures exist only for tests.
 *   2. That live-disabled error — and an invalid-domain rejection — are returned BEFORE any
 *      credit reserve, so the ledger is touched ZERO times (constitution NEVER #2).
 *
 * charge:"handler" for the same reason ranked_keywords uses it: this is a SYNCHRONOUS tool that
 * must run logic BEFORE the reserve, which charge:"surface" (reserve-then-handler) cannot
 * express. On the serving path it settles via withCredits WITHOUT a jobId — the exact SURFACE
 * ledger shape (reserve -> commit, a traceability uuid, no jobs row).
 *
 * One lookup is three paid DataForSEO requests (see dfs/backlinks.ts). The port throws unless
 * ALL THREE succeed, so a partial profile is never billed: withCredits releases the reserve and
 * the caller's balance ends where it started, whichever of the three failed.
 */

const NOT_ENABLED_MESSAGE =
  "Backlink lookups are not yet enabled on this deployment. Live DataForSEO data is turned " +
  "off, and SeoGrep never returns sample or placeholder figures as if they were real. This " +
  "tool will start returning data once live DataForSEO access is switched on — you were not " +
  "charged.";

const inputSchema = z.object({
  target: targetField("look up"),
  project_id: projectIdField,
  limit: z
    .number()
    .int()
    .min(1)
    .max(BACKLINKS_MAX_LIMIT)
    .default(BACKLINKS_MAX_LIMIT)
    .describe(
      `How many rows to return in EACH list — referring domains and anchors ` +
        `(1–${BACKLINKS_MAX_LIMIT}, default ${BACKLINKS_MAX_LIMIT}).`,
    ),
});

type AnalyzeBacklinksInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Analyze a domain's backlink profile — total backlinks, referring domains, dofollow-only " +
  "share, spam score, plus the top referring domains and anchor texts. Pass a target domain " +
  "(any public domain, including a competitor's) or a project_id to look up one of your own " +
  `sites. Synchronous — returns a report immediately. Costs ` +
  `${TOOL_COSTS.analyze_backlinks} credits. Needs a paid credit balance: it is not available on ` +
  "trial credits. If live DataForSEO access is unavailable on this deployment, the tool says " +
  "so and charges nothing.";

/**
 * Group digits with commas without depending on ICU/locale data (deterministic). Kept local on
 * purpose: sharing it would mean editing ranked_keywords, whose behaviour is pinned.
 */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A metric line value: a grouped number, or an honest "n/a" when DataForSEO had none. */
function metric(value: number | null): string {
  return value === null ? "n/a" : thousands(value);
}

/**
 * "12,372 — 10,914 dofollow-only (88%)". The clause is added ONLY when both counts are present
 * and the total is positive; otherwise the bare count is shown rather than a made-up ratio.
 *
 * The label is deliberately "dofollow-only", not "dofollow". DataForSEO documents
 * `referring_domains_nofollow` as the domains pointing AT LEAST ONE nofollow link at the target
 * — NOT the domains that link exclusively with nofollow. Subtracting it therefore yields the
 * domains carrying NO nofollow link at all, which is a STRICTER set than "passes at least one
 * dofollow link": a domain that links twice, once dofollow and once nofollow, is excluded here.
 * Calling that number "dofollow" would overstate it, so the renderer names exactly what it is.
 */
function renderReferringDomainsMetric(summary: BacklinkSummary): string {
  const { referring_domains: total, referring_domains_nofollow: nofollow } = summary;
  if (total === null) return "n/a";
  if (nofollow === null || total <= 0 || nofollow > total) return thousands(total);
  const dofollowOnly = total - nofollow;
  const share = Math.round((dofollowOnly / total) * 100);
  return `${thousands(total)} — ${thousands(dofollowOnly)} dofollow-only (${share}%)`;
}

/** The header for a truncatable list — honest about how much of the total is shown. */
function listHeader(label: string, list: BacklinkList<unknown>): string {
  const shown = list.rows.length;
  const truncated = list.total_count !== null && list.total_count > shown;
  return truncated ? `${label} (${shown} of ${thousands(list.total_count ?? 0)}):` : `${label} (${shown}):`;
}

/**
 * THE VENDOR'S rel-ATTRIBUTE BREAKDOWN — finding AB-2 / reference R-6.2 (2026-09-04).
 *
 * Google's spam policies name three DIFFERENT declarations a link can carry: `nofollow`,
 * `sponsored` (a paid or advertising link) and `ugc` (user-generated content). They are not
 * interchangeable, and the difference is exactly what a reader looking at a backlink profile is
 * trying to see: 88 links declared `sponsored` is a different picture from 88 links a site simply
 * nofollowed.
 *
 * The paid /backlinks/summary/live body has always carried that breakdown in
 * `referring_links_attributes`, and this report threw it away — it printed no `sponsored` count,
 * no `ugc` count and not even the raw `nofollow` count, only the percentage derived from the
 * separate `referring_domains_nofollow` field.
 *
 * WHAT IS PRINTED AND WHAT IS NOT. Every key the vendor sent, in the vendor's own spelling and in
 * the vendor's own order, with its own number: no bucketing, no total, no verdict, and nothing
 * added for an attribute DataForSEO did not mention. SeoGrep does not say whether a `sponsored`
 * link is a problem — R-6.2 is Google's rule and the counts are DataForSEO's.
 *
 * THREE STATES, THREE SENTENCES. A missing field is the vendor saying nothing; an empty map is
 * the vendor answering with no attribute counted; a populated map is the answer itself. Rendering
 * the first two as "sponsored 0" would publish a measurement nobody made (signed lesson 12).
 */
function renderLinkAttributes(attributes: Readonly<Record<string, number>> | null): string {
  if (attributes === null) return "not reported in this response";
  const buckets = Object.entries(attributes);
  if (buckets.length === 0) return "reported with no attribute counted";
  return buckets.map(([name, count]) => `${name} ${metric(count)}`).join(" · ");
}

function renderSummary(profile: BacklinkProfile, project: ProjectRef | null | undefined): string {
  const { summary } = profile;
  return [
    `Backlink profile for ${subjectLabel(profile.target, project)}:`,
    `• Backlinks: ${metric(summary.backlinks)}`,
    `• Link attributes (DataForSEO referring_links_attributes): ` +
      renderLinkAttributes(summary.referring_links_attributes),
    `• Referring domains: ${renderReferringDomainsMetric(summary)}`,
    `• Referring main domains: ${metric(summary.referring_main_domains)}`,
    `• Broken backlinks: ${metric(summary.broken_backlinks)}`,
    `• Backlink spam score: ${metric(summary.backlinks_spam_score)}`,
    `• Domain rank: ${metric(summary.rank)} of ${thousands(BACKLINK_RANK_MAX)}`,
  ].join("\n");
}

/**
 * A vendor SPAM SCORE, always under the vendor's own field name, and a silence always in WORDS —
 * the same shape disavow_candidates prints, and for the same two reasons.
 *
 * The NAME, because this report already prints a `backlinks_spam_score` for the WHOLE target in
 * its summary block; the per-domain one is the same vendor spelling on a different object, so the
 * row says which field it is rather than offering a second bare "spam score".
 *
 * The WORDS, because a missing score rendered as 0 would publish "DataForSEO scored this domain
 * clean" out of a response that said nothing at all — and 0 reads like the BEST possible answer
 * on exactly the axis a reader scans this list for (signed lesson 12).
 */
function vendorSpamScore(value: number | null): string {
  return value === null
    ? "backlinks_spam_score not reported by DataForSEO"
    : `backlinks_spam_score ${value}`;
}

/**
 * The top referring domains. The spam score rides along because DataForSEO returns it in the SAME
 * /backlinks/referring_domains/live body as the counts (measured 2026-08-25: poliste.com 26 in a
 * body whose rendered row showed only backlinks and rank) — so the reader of a 70-credit profile
 * can see WHICH source is suspicious without buying a second lookup. SeoGrep still adds no verdict
 * of its own: the number is printed under the vendor's field name and nothing is derived from it.
 */
function renderReferringDomainRow(row: ReferringDomainRow): string {
  return (
    `• ${row.domain} — ${metric(row.backlinks)} backlinks, rank ${metric(row.rank)}, ` +
    vendorSpamScore(row.backlinks_spam_score)
  );
}

function renderAnchorRow(row: AnchorRow): string {
  // An empty anchor is real data (image links carry no anchor text) — label it, don't hide it.
  const anchor = row.anchor === "" ? "(no anchor text)" : `"${row.anchor}"`;
  return `• ${anchor} — ${metric(row.backlinks)} backlinks`;
}

/**
 * =====================================================================================
 * THE OUTPUT CEILING — finding AB-1 (2026-09-04)
 * =====================================================================================
 * `limit` DEFAULTS to its own maximum (1,000), so the commonest 70-credit call is also the widest
 * one this schema allows. At the row widths MEASURED on the live run — a referring-domain row ~65
 * characters, an anchor row ~44 — a full default call computes to ~109,000 characters. That is
 * 1.7x the 62,729-character reply a client REFUSED from the sibling `backlink_details` on
 * 2026-08-25, where 35 credits and the vendor's $0.055 were both taken and the customer saw
 * nothing at all. This tool is the same family at TWICE the price and never had the ceiling that
 * incident bought.
 *
 * The default `limit` is NOT lowered here: it is a display control on a flat 70-credit price, and
 * changing what the default call returns is a behaviour decision for a human (finding AB-1 carries
 * it as a signature item). What is bounded is the RENDERED TEXT — the whole fetched window still
 * reaches the run report in domain_lookup_runs, so nothing measured is lost.
 *
 * THE SPLIT. The shared ceiling is 28,000 characters (format/output-budget.ts records how that
 * number was derived from the refusal). The referring-domain list gets the larger share: it is the
 * list this report is bought for, and its rows are the wider ones. Both budgets sit far above what
 * a live profile produced — 10,841 characters for 137 + 37 rows — so an ordinary lookup renders
 * exactly as it always did, and only the calculated worst case is cut.
 */
export const MAX_RENDERED_OUTPUT_CHARS = 28_000;
const REFERRING_DOMAIN_LIST_CHAR_BUDGET = 16_000;
const ANCHOR_LIST_CHAR_BUDGET = 8_000;

/**
 * Both lists arrive ordered by backlink count, descending — "top" in this report means exactly
 * that (dfs/backlinks.ts pins the vendor sort) — so the rows a ceiling drops are the SMALLEST ones.
 * The advice says which rows those were rather than selling a cheaper call: `limit` is not a price
 * control here, and a narrower list costs the same 70 credits.
 */
const REFERRING_DOMAIN_TRUNCATION_ADVICE =
  "This list is ordered by backlink count, most first, so the rows left out are the domains " +
  "sending the fewest links. Asking for a smaller `limit` returns a shorter list but does not " +
  `cost less: this lookup is a flat ${TOOL_COSTS.analyze_backlinks} credits whatever you ask for.`;

const ANCHOR_TRUNCATION_ADVICE =
  "This list is ordered by backlink count, most first, so the anchors left out are the ones " +
  "carrying the fewest links.";

/** One list: its header, the rows that fit the budget, and the note when some did not. */
function renderList<Row>(list: {
  readonly header: string;
  readonly rows: readonly Row[];
  readonly render: (row: Row) => string;
  readonly budget: number;
  readonly noun: string;
  readonly advice: string;
}): readonly string[] {
  const shown = renderWithinBudget(list.rows, list.render, list.budget);
  return [
    // Only when a single row is itself wider than the whole budget is the block empty; the note
    // below still says how many rows were fetched, so the reply never goes silent about them.
    shown.block === "" ? list.header : `${list.header}\n${shown.block}`,
    ...(shown.omitted === 0
      ? []
      : [renderOutputLimitNote(list.noun, shown.printed, shown.omitted, list.advice)]),
  ];
}

/**
 * The top referring domains. The spam score rides along because DataForSEO returns it in the SAME
 * /backlinks/referring_domains/live body as the counts (measured 2026-08-25: poliste.com 26 in a
 * body whose rendered row showed only backlinks and rank) — so the reader of a 70-credit profile
 * can see WHICH source is suspicious without buying a second lookup. SeoGrep still adds no verdict
 * of its own: the number is printed under the vendor's field name and nothing is derived from it.
 */
/**
 * WHY THE TWO REFERRING-DOMAIN COUNTS DISAGREE — finding AB-3 (2026-09-04).
 *
 * MEASURED on the live run: the summary line said `Referring domains: 139` and the list header two
 * lines below said `Top referring domains (137)`. Both numbers are DataForSEO's and both are
 * right; they are simply not the same measurement. The summary count comes from
 * /backlinks/summary/live, the list is what /backlinks/referring_domains/live returned for this
 * lookup, and dfs/backlinks.ts issues them as two separate paid requests.
 *
 * Printed on EVERY answer, including one whose list is empty: a reader who sees the pair agree
 * once will read them as one figure checked twice, which is exactly the confidence the two
 * endpoints do not support.
 */
export const TWO_ENDPOINT_COUNT_NOTE =
  "The referring-domain count in the summary above and the list below are two SEPARATE DataForSEO " +
  "measurements: the summary figure is `referring_domains` from /backlinks/summary/live, and the " +
  "list is what /backlinks/referring_domains/live returned for this lookup. They routinely " +
  "disagree by a few domains, and neither confirms the other.";

function renderReferringDomains(list: BacklinkList<ReferringDomainRow>): readonly string[] {
  if (list.rows.length === 0) {
    return [TWO_ENDPOINT_COUNT_NOTE, "Top referring domains: none on record."];
  }
  return [
    TWO_ENDPOINT_COUNT_NOTE,
    ...renderList({
      header: listHeader("Top referring domains", list),
      rows: list.rows,
      render: renderReferringDomainRow,
      budget: REFERRING_DOMAIN_LIST_CHAR_BUDGET,
      noun: "referring domain",
      advice: REFERRING_DOMAIN_TRUNCATION_ADVICE,
    }),
  ];
}

function renderAnchors(list: BacklinkList<AnchorRow>): readonly string[] {
  if (list.rows.length === 0) return ["Top anchors: none on record."];
  return renderList({
    header: listHeader("Top anchors", list),
    rows: list.rows,
    render: renderAnchorRow,
    budget: ANCHOR_LIST_CHAR_BUDGET,
    noun: "anchor",
    advice: ANCHOR_TRUNCATION_ADVICE,
  });
}

/**
 * Render the backlink profile as the plain-text tool output (pure — unit-tested directly).
 * `project` is passed only when the caller resolved the target from a project_id; a bare-target
 * call renders exactly as it always did.
 */
export function formatBacklinkProfile(
  profile: BacklinkProfile,
  project?: ProjectRef | null,
): string {
  return [
    renderSummary(profile, project),
    ...renderReferringDomains(profile.top_referring_domains),
    ...renderAnchors(profile.top_anchors),
  ].join("\n\n");
}

/** Dependencies — the backlinks port is injectable so tests run offline (mock/disabled). */
export interface AnalyzeBacklinksDeps {
  /**
   * The backlinks port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: BacklinksPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The run recorder (default: the real `writeDomainLookupRun`). A PORT for the reason every
   * other writer in this family is one: a spec can make it FAIL without breaking a database, which
   * is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: DomainLookupRunWriter;
}

export function makeAnalyzeBacklinksTool(deps: AnalyzeBacklinksDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeDomainLookupRun;
  return defineTool<AnalyzeBacklinksInput>({
    name: "analyze_backlinks",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — resolve WHAT to look up: exactly one of project_id / target,
      // the project read tenant-scoped, the domain canonicalized by the shared normalizer. Every
      // rejection it returns costs nothing (see project-target.ts).
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      const port = deps.port ?? resolveDefaultBacklinksPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve mock data.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch ->
      // commit as one chain. Any of the three DataForSEO requests failing throws, so withCredits
      // releases and a partial profile is never billed.
      // WHICH PROJECT THE SPEND IS FOR, on the ledger row itself (migration 0033) — the same
      // ownership-gated project the run row below records. charge:"handler" settles its own
      // credits, so nothing upstream can supply this; undefined on a bare-target call is a REAL
      // answer ("no project scope"), never a gap (credits/guard.ts).
      const meta = { tool: "analyze_backlinks", projectId: subject.project?.id } as const;
      return withCredits({ userId: ctx.userId }, meta, async () => {
        const profile = await port.fetchBacklinkProfile({
          target: subject.domain,
          limit: input.limit,
        });
        // THE RUN IS RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT guarded
        // (migration 0027; dfs/runs.ts states the same contract from the other side). withCredits
        // commits a handler that RETURNS and releases one that THROWS, so an error escaping here
        // costs the tenant nothing. Caught and logged instead, the shape would be the house's
        // worst at 70 credits a call: a charged caller, a delivered profile, and a panel that says
        // forever that the lookup never ran.
        //
        // `projectId` is null on a bare-target call — the commonest PAID call this tool serves,
        // and the one 0027 made project_id nullable to record. `target` is the RESOLVED domain,
        // never the caller's raw input.
        await writeRun(
          {
            userId: ctx.userId,
            projectId: subject.project?.id ?? null,
            tool: "analyze_backlinks",
            target: subject.domain,
          },
          backlinksRunReport(profile, { limit: input.limit }),
        );
        return textResult(formatBacklinkProfile(profile, subject.project));
      });
    },
  });
}

/** The production analyze_backlinks tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const analyzeBacklinksTool = makeAnalyzeBacklinksTool();
