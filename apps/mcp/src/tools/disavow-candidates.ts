import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import {
  CANDIDATE_ORDER_VENDOR_FIELD,
  DEFAULT_LINK_ROWS,
  DEFAULT_NETWORK_ROWS,
  DISAVOW_TXT_PROPOSAL_NOTICE,
  isNofollowOnlyInWindow,
  LINK_WINDOW_ORDER_VENDOR_FIELD,
  MAX_LINK_ROWS,
  MAX_NETWORK_ROWS,
  resolveDefaultDisavowCandidatesPort,
  VENDOR_SPAM_SCORE_MAX,
  VENDOR_SPAM_SCORE_MIN,
  type CandidateSet,
  type DisavowCandidate,
  type DisavowCandidates,
  type DisavowCandidatesPort,
  type DisavowCriteria,
  type ReferringNetworkRow,
} from "../dfs/disavow-candidates.ts";
import type { BacklinkDetailRow } from "../dfs/backlink-details.ts";
// The window caption is IMPORTED rather than re-written: it is the one sentence pair that keeps a
// fetched slice from being read as the whole set, and a second copy of that wording is a second
// place for it to go wrong (backlink-details.ts's module header has the 42,671,699 case).
import { renderWindowCaption } from "./backlink-details.ts";
import {
  disavowCandidatesRunReport,
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
 * disavow_candidates — the referring domains behind a site's worst-scoring live backlinks, plus
 * the BODY of a Google-format disavow file built from them. Three DataForSEO Backlinks requests
 * per call, described in dfs/disavow-candidates.ts (Part A).
 *
 * =====================================================================================
 * THE HARD RULE: THIS TOOL PROPOSES. IT NEVER SUBMITS.
 * =====================================================================================
 * The disavow text is returned to the conversation as TEXT. There is no submission path here —
 * no Search Console call, no upload, no "apply", not behind a flag and not as a TODO. The outside
 * world belongs to the human (contract.md), and the port pins the same rule three ways (every
 * transport URL starts with https://api.dataforseo.com/, the endpoint constants are asserted as a
 * set, and the generated file text carries the refusal in its own first lines). This surface adds
 * a fourth pin: the refusal is printed in the tool output too, and disavow-candidates.test.ts
 * scans THIS MODULE'S OWN SOURCE for a submission path.
 *
 * =====================================================================================
 * NEVER #7 — "CANDIDATE FOR DISAVOW" IS A JUDGEMENT ABOUT SOMEONE ELSE'S SITE
 * =====================================================================================
 * So SeoGrep does not make one. Every signal printed is a DataForSEO field under DataForSEO's own
 * name, including the vendor's three different spellings, which are three different measurements:
 *
 *   backlink_spam_score   — per LINK,    /backlinks/backlinks/live;
 *   spam_score            — per DOMAIN,  /backlinks/bulk_spam_score/live;
 *   backlinks_spam_score  — per NETWORK, /backlinks/referring_networks/live.
 *
 * Nothing here composes them into a score, a "toxicity", a "risk level" or a recommendation, and
 * nothing here asserts that Google would penalise anything. "Candidate" means exactly one thing,
 * and the output says it: the vendor's score met the threshold THE CALLER chose.
 *
 * THE THRESHOLD IS THE CALLER'S, AND IT IS REQUIRED. `min_backlink_spam_score` has NO default —
 * not here and not in the port. DataForSEO publishes the score but no cut-off, so any number
 * SeoGrep defaulted to would be an invented threshold arriving with the authority of a product
 * default (NEVER #7 and #9); a caller who has not decided what counts as spam has not yet asked
 * this question. The schema therefore requires the number, describes it as the caller's judgement,
 * and the output repeats the number that was used.
 *
 * Same credit path and the same two hard product rules as backlink_details:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear English
 *      error and NEVER serves sample/placeholder rows as if they were real (NEVER #7).
 *   2. That live-disabled error — and every invalid-input rejection — is returned BEFORE any
 *      credit reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler": a SYNCHRONOUS tool that must run logic BEFORE the reserve. It settles via
 * withCredits WITHOUT a jobId (reserve -> commit, no jobs row). One lookup is charged ONCE; if any
 * vendor request fails, withCredits releases and nothing is billed.
 */

const NOT_ENABLED_MESSAGE =
  "Disavow candidates are not yet enabled on this deployment. Live DataForSEO data is turned off, " +
  "and SeoGrep never returns sample or placeholder rows as if they were real. This tool will " +
  "start returning data once live DataForSEO access is switched on — you were not charged.";

/**
 * THE ROW ARGUMENTS ARE DISPLAY CONTROLS, AND THE SCHEMA SAYS SO.
 *
 * `limit` used to read "DataForSEO bills per returned row, so this is the price control, not a
 * display preference". Both halves were wrong for the caller. The credit price is FLAT — one
 * lookup is TOOL_COSTS.disavow_candidates credits at limit 1 and at limit 300 alike — and the
 * vendor bill barely moves either: the Backlinks tariff is a flat fee per REQUEST plus $0.000036
 * a row, and this lookup pays three of those flat fees. From the cost model in
 * dfs/disavow-candidates.ts, tripling `limit` from the 100 default to the 300 cap moves the link
 * request from $0.0276 to $0.0348, and the whole lookup (with `network_limit` at its own cap)
 * from $0.0799 to $0.0918 — 3x the rows for ~15% more vendor money, none of which the caller pays.
 * The same claim was MEASURED FALSE 2026-08-25 on backlink_details, which reads the SAME endpoint:
 * `limit 10` cost $0.04854 and `limit 200` (187 rows) cost $0.05506 — 19x the rows, 13% more.
 * A caller who narrows the window to save money pays the same and receives less.
 */
const inputSchema = z.object({
  target: targetField("find disavow candidates for"),
  project_id: projectIdField,
  min_backlink_spam_score: z
    .number()
    .int()
    .min(VENDOR_SPAM_SCORE_MIN)
    .max(VENDOR_SPAM_SCORE_MAX)
    .describe(
      `REQUIRED, and deliberately with no default: the DataForSEO backlink_spam_score a link must ` +
        `reach to enter the window (${VENDOR_SPAM_SCORE_MIN}-${VENDOR_SPAM_SCORE_MAX}, the ` +
        "vendor's own scale). This cut-off is YOUR judgement: DataForSEO publishes the score but " +
        "no threshold, so SeoGrep will not supply one — a default here would be an invented " +
        `number wearing a recommendation's clothes. ${VENDOR_SPAM_SCORE_MIN} means no threshold ` +
        "at all. The output repeats the number you chose.",
    ),
  dofollow_only: z
    .boolean()
    .default(false)
    .describe(
      "Keep only links DataForSEO marks dofollow (default false — no filter). A narrower window " +
        "for the same price; it does not change what any score means.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LINK_ROWS)
    .default(DEFAULT_LINK_ROWS)
    .describe(
      `How many filtered backlinks to examine (1-${MAX_LINK_ROWS}, default ${DEFAULT_LINK_ROWS}). ` +
        `A display control, NOT a price control: this call costs ${TOOL_COSTS.disavow_candidates} ` +
        "credits whatever you ask for, and asking for fewer rows costs the same. DataForSEO's own " +
        "bill for this lookup is nearly all flat per-request fees — three of them, one per " +
        "endpoint — and rows are charged in ten-thousandths of a cent: measured on the same vendor " +
        "endpoint this tool reads, 19x the rows cost 13% more. The candidate domains are derived " +
        "from exactly these rows, so a narrower window buys less and saves nothing.",
    ),
  network_limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_NETWORK_ROWS)
    .default(DEFAULT_NETWORK_ROWS)
    .describe(
      `How many referring NETWORKS (IP subnets) to return (1-${MAX_NETWORK_ROWS}, default ` +
        `${DEFAULT_NETWORK_ROWS}). Same rule as limit: a display control, and asking for fewer ` +
        "rows costs the same. A separate axis: several linking domains sitting in one subnet is a " +
        "fact about addresses, not a verdict.",
    ),
});

type DisavowCandidatesInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Find candidate referring domains for a Google disavow file, and return the disavow file's " +
  "text for you to review. Pass a target domain (any public domain) or a project_id, plus " +
  "min_backlink_spam_score — the DataForSEO score threshold, which you choose, because the " +
  "vendor publishes no cut-off. Returns the filtered link window, the candidate domains ordered " +
  "by DataForSEO's own spam_score, the referring IP networks, and the disavow text. It is a " +
  "PROPOSAL: SeoGrep does not submit disavow files to Google and sends nothing anywhere. " +
  `Synchronous — everything comes back immediately. Costs ${TOOL_COSTS.disavow_candidates} ` +
  "credits. Needs a paid credit balance: it is not available on trial credits. If live " +
  "DataForSEO access is unavailable on this deployment, the tool says so and charges nothing.";

/** Group digits with commas without depending on ICU/locale data (deterministic). */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A vendor COUNT: grouped, or an honest "n/a" when DataForSEO sent none. A zero is a zero. */
function metric(value: number | null): string {
  return value === null ? "n/a" : thousands(value);
}

/**
 * A vendor SPAM SCORE, always under the vendor's own field name, and a silence always in WORDS.
 *
 * Both halves are load-bearing. The NAME, because this one output carries all three of the
 * vendor's spellings and they measure three different objects — flattening them into one label
 * like "spam score" would invent a single measurement that DataForSEO never published. The WORDS,
 * because a missing score rendered as 0 would publish "the vendor scored this domain clean" from
 * a response that said nothing at all, on a page whose whole subject is which domains to name in
 * a disavow file.
 */
function vendorScore(field: string, value: number | null): string {
  return value === null ? `${field} not reported by DataForSEO` : `${field} ${value}`;
}

/** Whether a link is followed, or an honest admission that DataForSEO did not say. */
function followClause(dofollow: boolean | null): string {
  if (dofollow === null) return "follow status not reported by DataForSEO";
  return dofollow ? "dofollow" : "nofollow";
}

/** A URL the vendor may not have named. Absent is said out loud, never left as a gap. */
function urlOrUnnamed(url: string | null): string {
  return url ?? "(DataForSEO did not name it)";
}

/** The anchor, or WHY there is none — the vendor's own item_type explains a blank. */
function anchorClause(row: BacklinkDetailRow): string {
  if (row.anchor !== "") return `anchor "${row.anchor}"`;
  return row.item_type === null ? "no anchor text" : `no anchor text (${row.item_type} link)`;
}

/**
 * ONE row of the filtered window. It names `backlink_spam_score` explicitly rather than printing
 * a friendly "spam score" caption: three different vendor fields appear in this output, and the
 * reader has to be able to tell which measurement each number is.
 */
export function renderFilteredLinkRow(row: BacklinkDetailRow): string {
  const broken = row.is_broken === true ? " · DataForSEO flags this link as broken" : "";
  return (
    `• ${row.domain_from} → ${urlOrUnnamed(row.url_to)}\n` +
    `  from ${urlOrUnnamed(row.url_from)} · ${anchorClause(row)} · ${followClause(row.dofollow)} · ` +
    `${vendorScore(LINK_WINDOW_ORDER_VENDOR_FIELD, row.backlink_spam_score)} · ` +
    `first seen ${row.first_seen ?? "n/a"} · last seen ${row.last_seen ?? "n/a"}${broken}`
  );
}

/**
 * The nofollow-only marking, in the ANSWER. The file carries its own copy (nofollowOnlyNote), for
 * the reason the refusal is printed twice: the file leaves this conversation and the answer does
 * not. It says only what was measured — none of these links is MARKED dofollow — because a link
 * the vendor never marked either way is not a link the vendor called nofollow.
 */
export const NOFOLLOW_ONLY_MARKER =
  "NONE of these links is marked dofollow by DataForSEO — Google does not count nofollowed " +
  "links, so disavowing this domain may change nothing.";

/**
 * ONE candidate domain. The vendor's per-domain `spam_score` leads, because that is the ONE field
 * the list is ordered by; the window counts that follow are explicitly OURS ("in this window"),
 * so a reader cannot mistake them for the domain's total link count. The per-LINK score sits
 * beside it under its OWN vendor name — the two disagree routinely, and the level each one
 * describes is the difference between reading a 0 as reassurance and reading it as one endpoint's
 * answer to one question.
 */
export function renderCandidateRow(candidate: DisavowCandidate): string {
  const links = candidate.window_link_count;
  const counts =
    `${thousands(links)} ${links === 1 ? "link" : "links"} in this window ` +
    `(${thousands(candidate.window_dofollow_link_count)} marked dofollow by DataForSEO)`;
  const worst = `worst ${vendorScore(
    LINK_WINDOW_ORDER_VENDOR_FIELD,
    candidate.window_max_backlink_spam_score,
  )} in this window`;
  const marking = isNofollowOnlyInWindow(candidate) ? `\n  ${NOFOLLOW_ONLY_MARKER}` : "";
  return (
    `• ${candidate.domain} — ${vendorScore(CANDIDATE_ORDER_VENDOR_FIELD, candidate.spam_score)}\n` +
    `  ${counts} · ${worst}\n` +
    `  example: ${urlOrUnnamed(candidate.window_example_url_from)} → ` +
    `${urlOrUnnamed(candidate.window_example_url_to)}${marking}`
  );
}

/** ONE referring network. `rank` is not claimed: a network is not a domain and is not rank-scored. */
export function renderNetworkRow(row: ReferringNetworkRow): string {
  const lost = row.lost_date === null ? "" : ` · lost ${row.lost_date}`;
  return (
    `• ${row.network_address}\n` +
    `  ${metric(row.backlinks)} backlinks · ${metric(row.referring_domains)} referring domains ` +
    `(${metric(row.referring_domains_nofollow)} nofollow) · ` +
    `${metric(row.referring_main_domains)} main domains · ` +
    `${vendorScore("backlinks_spam_score", row.backlinks_spam_score)} · ` +
    `first seen ${row.first_seen ?? "n/a"}${lost}`
  );
}

/**
 * WHAT PRODUCED THIS LIST, in the caller's own numbers. Printed before any row, because a list of
 * other people's domains under the word "disavow" is read as an accusation unless the reader can
 * see that it is a filter they specified over a window they bounded.
 */
export function renderCriteria(criteria: DisavowCriteria): string {
  const dofollow = criteria.dofollow_only
    ? "only links DataForSEO marks dofollow were kept"
    : "followed and nofollowed links were both kept";
  return (
    `How this list was built: DataForSEO filtered this site's LIVE backlinks on its own ` +
    `${criteria.link_window_ordered_by_vendor_field} >= ${criteria.min_backlink_spam_score} — a ` +
    `threshold you chose, not one DataForSEO or SeoGrep recommends — and ${dofollow}. Every ` +
    `domain that window named was then scored by DataForSEO's bulk_spam_score endpoint, and the ` +
    `candidates below are ordered by that separate field, ${criteria.candidates_ordered_by_vendor_field}, ` +
    `highest first, capped at ${thousands(criteria.candidate_cap)} domains. Two vendor fields on ` +
    `two endpoints; SeoGrep combines them into no score of its own.`
  );
}

/**
 * The candidate caption. This set is DERIVED from the window rather than fetched, so — unlike the
 * two vendor windows beside it — it gets no "DataForSEO counts N in total" sentence: there is no
 * vendor whole-set number for it, and inventing one would be a measurement nobody made. What it
 * says instead is exactly what it is: a count over the rows above, under a cap.
 */
export function renderCandidateCaption(candidates: CandidateSet, linkRowCount: number): string {
  const listed = candidates.window_candidate_count;
  const distinct = candidates.window_distinct_domain_count;
  const trimmed =
    distinct > listed
      ? ` The window named ${thousands(distinct)} distinct domains and the cap kept the ` +
        `${thousands(listed)} with the highest ${CANDIDATE_ORDER_VENDOR_FIELD}.`
      : "";
  return (
    `Candidate referring domains — ${thousands(listed)} ${listed === 1 ? "domain" : "domains"}, ` +
    `derived from the ${thousands(linkRowCount)} link ${linkRowCount === 1 ? "row" : "rows"} in ` +
    `the window above (cap ${thousands(candidates.window_candidate_cap)}). This is a count of ` +
    `that window, not of every domain linking to this site.${trimmed}`
  );
}

/**
 * The refusal, printed in the OUTPUT as well as inside the file. A caveat that lives only in one
 * of the two travels apart from the other the moment someone copies the file out of the chat.
 */
export const NO_SUBMISSION_NOTICE = DISAVOW_TXT_PROPOSAL_NOTICE;

/** What the file is, and whose job uploading it is. */
export const DISAVOW_FILE_CAPTION =
  "Proposed disavow file, in Google's documented format — review every line before you use it. " +
  "If you decide to go ahead, you upload it yourself in Google Search Console: SeoGrep does not " +
  "submit disavow files and has sent nothing to Google.";

/**
 * Whose numbers these are, and what "candidate" does and does not mean. Printed on every answer.
 * A list of domains under the heading "disavow" reads as SeoGrep's verdict on those sites, and
 * SeoGrep does not have one (NEVER #7) — the vendor published three scores and the caller picked
 * a threshold, and that is the whole of it.
 */
export const VENDOR_JUDGEMENT_NOTE =
  "Every score above is DataForSEO's own field, printed under the vendor's own name: " +
  "backlink_spam_score for one link, spam_score for one referring domain, backlinks_spam_score " +
  "for one network. They are three different measurements on three different objects, and " +
  "SeoGrep does not combine them into a score of its own. \"Candidate\" here means only that " +
  "DataForSEO's score met the threshold you set — it is not a finding that these links hurt " +
  "your site, and neither DataForSEO nor SeoGrep can tell you what Google makes of any of them. " +
  "A domain DataForSEO did not score is shown as unreported, never as a zero. Disavowing links " +
  "that were fine can cost you the value they were passing, so review every line yourself.";

/** The "nothing matched" answer — a real, delivered result rather than an error. */
function renderNoCandidates(result: DisavowCandidates, project?: ProjectRef | null): string {
  const subject = subjectLabel(result.target, project);
  const { window_offset: offset, window_limit: limit } = result.links;
  return [
    `No disavow candidates for ${subject}.`,
    NO_SUBMISSION_NOTICE,
    renderCriteria(result.criteria),
    `DataForSEO returned no backlink matching those criteria in the window that was asked for ` +
      `(offset ${thousands(offset)}, limit ${thousands(limit)}). That is an answer about this ` +
      `window and this threshold — it is not a statement that the site has no such links.`,
  ].join("\n\n");
}

/** Render one lookup as the plain-text tool output (pure — unit-tested directly). */
export function formatDisavowCandidates(
  result: DisavowCandidates,
  project?: ProjectRef | null,
): string {
  if (result.candidates.rows.length === 0) {
    return renderNoCandidates(result, project);
  }
  const subject = subjectLabel(result.target, project);
  const blocks = [
    `Disavow candidates for ${subject} — a proposal for you to review:`,
    NO_SUBMISSION_NOTICE,
    renderCriteria(result.criteria),
  ];
  if (result.links.rows.length > 0) {
    blocks.push(
      renderWindowCaption("Filtered backlinks", "backlink", result.links),
      result.links.rows.map(renderFilteredLinkRow).join("\n"),
    );
  }
  blocks.push(
    renderCandidateCaption(result.candidates, result.links.window_row_count),
    result.candidates.rows.map(renderCandidateRow).join("\n"),
  );
  if (result.referring_networks.rows.length > 0) {
    blocks.push(
      renderWindowCaption("Referring networks (IP subnets)", "network", result.referring_networks),
      result.referring_networks.rows.map(renderNetworkRow).join("\n"),
    );
  }
  blocks.push(DISAVOW_FILE_CAPTION, result.disavow_txt.trimEnd(), VENDOR_JUDGEMENT_NOTE);
  return blocks.join("\n\n");
}

/** Dependencies — the port is injectable so tests run offline (mock/disabled). */
export interface DisavowCandidatesDeps {
  /**
   * The disavow-candidates port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: DisavowCandidatesPort;
  /** The tenant-scoped project loader (default: the real one). Injected so tests run DB-less. */
  readonly loadProject?: LoadProjectFn;
  /**
   * The run recorder (default: the real `writeDomainLookupRun`, migration 0031). A PORT for the
   * reason every other writer in this family is one: a spec can make it FAIL without breaking a
   * database, which is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeRun?: DomainLookupRunWriter;
}

export function makeDisavowCandidatesTool(deps: DisavowCandidatesDeps = {}): RegisteredTool {
  const writeRun = deps.writeRun ?? writeDomainLookupRun;
  return defineTool<DisavowCandidatesInput>({
    name: "disavow_candidates",
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
      const port = deps.port ?? resolveDefaultDisavowCandidatesPort();
      // Free pre-reserve gate 2 — refuse rather than reserve credits or serve mock rows.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> fetch -> commit
      // as one chain. Any of the vendor requests failing throws, so withCredits releases.
      // WHICH PROJECT THE SPEND IS FOR, on the ledger row itself (migration 0033) — the
      // ownership-gated project resolved above. charge:"handler" settles its own credits, so
      // nothing upstream can supply this; undefined on a bare-target call is a REAL answer
      // ("no project scope"), never a gap (credits/guard.ts).
      const meta = { tool: "disavow_candidates", projectId: subject.project?.id } as const;
      return withCredits({ userId: ctx.userId }, meta, async () => {
        const result = await port.fetchDisavowCandidates({
          target: subject.domain,
          limit: input.limit,
          min_backlink_spam_score: input.min_backlink_spam_score,
          dofollow_only: input.dofollow_only,
          network_limit: input.network_limit,
        });
        const text = formatDisavowCandidates(result, subject.project);
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
        //
        // The report takes NO query argument: every criterion is already inside `result.criteria`,
        // at the value the lookup RAN under rather than the value the caller typed (the port
        // clamps both row caps and the score). See disavowCandidatesRunReport.
        await writeRun(
          {
            userId: ctx.userId,
            projectId: subject.project?.id ?? null,
            tool: "disavow_candidates",
            target: subject.domain,
          },
          disavowCandidatesRunReport(result),
        );
        return textResult(text);
      });
    },
  });
}

/** The production disavow_candidates tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const disavowCandidatesTool = makeDisavowCandidatesTool();
