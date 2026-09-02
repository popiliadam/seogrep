import { z } from "zod";
import {
  analyzeTitleQueryMatch,
  MAX_CONTENT_MISMATCHES,
  type ContentMatchResult,
  type ContentMismatch,
  type ContentPageRecord,
  type ContentQueryRow,
} from "@pseo/core";
import { TOOL_COSTS, type ToolName } from "../credits/costs.ts";
import {
  crawlScopeLine,
  loadLatestCrawl,
  type AuditCrawl,
  type LoadCrawlFn,
} from "../audit/index.ts";
import {
  brandTokenOf,
  foldBrandWord,
  loadLatestPull,
  matchBrand,
  renderAnalyzedWindow,
  renderPullProvenance,
  renderRowCapCaveat,
  type LoadPullFn,
  type PullData,
} from "../gsc-data/index.ts";
import { isAllFunctionWords } from "../gsc-data/function-words.ts";
import {
  formatContentMismatches,
  renderBrandExclusion,
  renderContentCoverage,
  renderFunctionWordExclusion,
} from "./audit-content-format.ts";
import {
  contentAuditReport,
  writeContentAuditRun,
  type ContentAuditReport,
  type ContentAuditRunWriter,
} from "./audit-content-runs.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";
import { PreconditionNotMetError } from "./precondition.ts";
import {
  ARCHIVED_PROJECT_MESSAGE,
  loadOwnProject,
  type LoadProjectFn,
} from "./project-target.ts";

/**
 * audit_content — SYNC. The bridge between the two halves of the product: it joins the queries a
 * project already EARNS IMPRESSIONS FOR (a stored `pull_gsc_data` window) against what each of
 * its pages actually SAYS (a stored `crawl_site` run), and reports the queries whose words appear
 * nowhere in the title or h1s of the page being shown for them.
 *
 * IT IS THE FIRST TOOL THAT NEEDS BOTH INPUTS, and everything unusual about it follows from that:
 * two preconditions instead of one, two job ids on its row, and its own table (0026) rather than
 * a fourth value in `audit_runs` or `gsc_discovery_runs`, neither of which can name both inputs.
 *
 * NO NEW EXTERNAL DATA. Both inputs are already paid for and already stored; the engine is pure
 * and lives in `@pseo/core`. The price is the analysis.
 *
 * Money-safety, identical to `makeAuditTool` / `makeDiscoveryTool`: charge is the DEFAULT
 * "surface", so the reserve opens BEFORE the handler runs and withCredits COMMITS a handler that
 * RETURNS. Every refusal below must therefore THROW — a returned error result would charge the
 * caller for being told which tool to run first — and every throw is TYPED, because the registry
 * keys on the ERROR TYPE to print a designed refusal verbatim instead of the generic crash
 * sentence (26 live calls got the generic one on 2026-08-09).
 */

/**
 * The tools/list sentence. Short ON PURPOSE: the docs generator strips the cost clause and uses
 * what is left as the page's `<meta name="description">`, truncating past 155 characters — so a
 * longer sentence here would ship a page whose description ends mid-clause with an ellipsis. The
 * behaviour prose belongs on the page (DOC_PROSE), not in the LLM-facing surface.
 *
 * The cost is INTERPOLATED from TOOL_COSTS rather than typed, so the number a user reads before
 * spending cannot drift from the number the guard reserves (research_keywords' pattern).
 */
const DESCRIPTION =
  "Find queries your pages rank for but never mention in their title or h1, joining your " +
  `latest pull and crawl. Costs ${TOOL_COSTS.audit_content} credits. ` +
  "Run pull_gsc_data and crawl_site first.";

export interface ContentAuditToolDeps {
  /** The pull loader (default: the real tenant-scoped loadLatestPull). Injected in tests. */
  readonly loadPull?: LoadPullFn;
  /** The crawl loader (default: the real tenant-scoped loadLatestCrawl). Injected in tests. */
  readonly loadCrawl?: LoadCrawlFn;
  /**
   * The run recorder (default: the real `writeContentAuditRun`). A PORT for the same reason the
   * two loaders are — and so a spec can make the write fail without breaking a database.
   */
  readonly writeRun?: ContentAuditRunWriter;
  /**
   * The tenant-scoped project reader the archive gate uses (default: the real loadOwnProject).
   * A PORT like the loaders, because this lane's fast specs are DB-less by construction — the
   * default reaches getServiceClient, which requires the full prod env.
   */
  readonly loadProject?: LoadProjectFn;
}

const inputSchema = z.object({
  project_id: z
    .uuid()
    .describe("The project to audit (must have run pull_gsc_data and crawl_site first)."),
  // The crawl half of this join gets the same optional selector the three structural audits took
  // (audit-shared.ts states why). The PULL half deliberately has no twin: this tool reads the
  // pull's CURRENT window and its footer already names it, so a second selector would double the
  // surface for an axis nobody has been unable to reach.
  job_id: z
    .uuid()
    .optional()
    .describe(
      "Optional: the crawl_site job to audit against (from list_jobs). Omit to use the " +
        "project's most recent crawl.",
    ),
});

/** The demand side, as the engine takes it: the pull's CURRENT window, flattened. */
function demandRows(pull: PullData): ContentQueryRow[] {
  return pull.current.rows.map((row) => ({
    query: row.query,
    page: row.page,
    impressions: row.impressions,
    clicks: row.clicks,
  }));
}

/**
 * The supply side: the crawl's pages, narrowed to the three fields the engine reads.
 *
 * Non-2xx pages are kept deliberately. A 404 that still draws impressions is one of the most
 * actionable findings this data can produce, and filtering by status here would silently remove
 * it — the status axis belongs to audit_tech, and this tool must not quietly re-decide it.
 */
function supplyPages(crawl: AuditCrawl): ContentPageRecord[] {
  return crawl.pages.map((page) => ({ url: page.url, title: page.title, h1s: page.h1s }));
}

/** What one run produced: the row's structural report and the text the caller reads. */
interface ContentAuditRendering {
  readonly report: ContentAuditReport;
  readonly text: string;
}

/**
 * The engine's own cap, lifted so the FILTERS below run over every mismatch rather than over the
 * first fifty. Filtering a pre-capped list would silently shrink the answer: fifty rows in, eight
 * of them branded, forty-two out — and `total` would still claim fifty. The engine builds the
 * full array either way, so this costs nothing but the slice.
 */
const UNCAPPED = Number.MAX_SAFE_INTEGER;

/** A filtered result, plus how many findings each gate removed entirely. */
interface FilteredResult {
  readonly result: ContentMatchResult;
  /** Mismatches whose ONLY missing words were the brand's own — dropped, and counted. */
  readonly brandExcluded: number;
  /** Mismatches left saying nothing but function words — dropped, and counted. */
  readonly functionExcluded: number;
}

/** One gate's verdict over the whole list: what survived, and how much it removed. */
interface Gate {
  readonly kept: ContentMismatch[];
  readonly excluded: number;
}

/**
 * Treat the site's own brand as ALREADY ON THE PAGE.
 *
 * Measured 2026-08-25 on dentnotion.com, verbatim:
 *   `"dent notion" -> https://dentnotion.com/seferihisar-dis-klinigi — 137 impressions;
 *    missing "dent", "notion" (0/2 words present)`
 * The firm's own name, reported to the firm as a keyword its page fails to mention. A brand is on
 * its own site whatever the title says — in the logo, the header, the domain in the SERP — and
 * "add your company name to your title" is not a finding anybody acts on.
 *
 * The blast radius is deliberately small, which is why this uses EVERY tier of the brand match
 * while detect_cannibalization does not: there, a brand match removes a whole finding, so the
 * weak tier needs corroboration; here it only removes ONE WORD from a row's missing list. A row
 * disappears only when the brand accounted for all of its missing words, and that row said
 * nothing else. On dental.com "dental implants" therefore keeps its place and reports "implants".
 */
function withoutBrandWords(mismatches: readonly ContentMismatch[], token: string | null): Gate {
  if (token === null) return { kept: [...mismatches], excluded: 0 };
  const kept: ContentMismatch[] = [];
  let excluded = 0;
  for (const mismatch of mismatches) {
    const brand = matchBrand(mismatch.query, token);
    const brandAtoms = new Set(brand?.brandAtoms ?? []);
    const missing = mismatch.missing_words.filter((word) => !brandAtoms.has(foldBrandWord(word)));
    if (missing.length === 0) {
      excluded += 1;
    } else if (missing.length === mismatch.missing_words.length) {
      kept.push(mismatch);
    } else {
      const matched = mismatch.total_words - missing.length;
      kept.push({
        ...mismatch,
        missing_words: missing,
        matched_words: matched,
        match_ratio: matched / mismatch.total_words,
      });
    }
  }
  return { kept, excluded };
}

/**
 * Drop the findings that have nothing left to say — the ones whose missing words are ALL
 * function words.
 *
 * Measured on the same report: thirteen of fifty rows said nothing but `missing "daha", "iyi"`
 * ("more", "good"), and others `missing "mı"`, `missing "yoksa"`, `missing "hangi"`.
 *
 * A FINDING GATE, NOT A WORD GATE, and the difference is load-bearing (function-words.ts states
 * it from the other side): no word is ever struck out of a row that has content beside it, so
 * `en iyi diş hekimi` keeps its place AND keeps "iyi" in its missing list. Striking the word
 * everywhere would be the version that quietly deletes meaning.
 *
 * It runs AFTER the brand gate, on purpose: the brand gate is what turns "dentnotion daha iyi"
 * into a row whose only remaining words are function words, and a row that reaches that state
 * has exactly as little to say as one that started there.
 */
function withoutFunctionWordRows(mismatches: readonly ContentMismatch[]): Gate {
  const kept = mismatches.filter((m) => !isAllFunctionWords(m.missing_words));
  return { kept, excluded: mismatches.length - kept.length };
}

/** Both gates, then the shortlist cap — in that order, for the reason UNCAPPED exists. */
function filterMismatches(result: ContentMatchResult, token: string | null): FilteredResult {
  const brand = withoutBrandWords(result.mismatches, token);
  const functionWords = withoutFunctionWordRows(brand.kept);
  return {
    // `total` is re-derived from the KEPT list, so the pre-cap headline the caller reads counts
    // the findings that survived rather than the ones the engine produced.
    result: {
      ...result,
      mismatches: functionWords.kept.slice(0, MAX_CONTENT_MISMATCHES),
      total: functionWords.kept.length,
    },
    brandExcluded: brand.excluded,
    functionExcluded: functionWords.excluded,
  };
}

/**
 * Run the engine and render BOTH halves from the SAME call, so the stored row and the reply can
 * never describe different runs (`AuditRendering` / `DiscoveryRendering`, verbatim reasoning).
 *
 * Exported so the fast lane can exercise it under a 0-credit tool name — a spec naming
 * `audit_content` would open a credit reserve and need a database.
 */
export function renderContentAudit(
  pull: PullData,
  crawl: AuditCrawl,
): ContentAuditRendering {
  const raw = analyzeTitleQueryMatch(demandRows(pull), supplyPages(crawl), UNCAPPED);
  const { result, brandExcluded, functionExcluded } = filterMismatches(raw, brandTokenOf(pull));
  // COVERAGE FIRST (operator-approved 2026-08-25, price unchanged). The sentence itself is
  // untouched — it was already the honest one — but it used to sit under fifty rows, so a caller
  // read the whole list before learning that 5,907 of 6,972 pairs could not be checked at all.
  // A ratio that changes how you read the list has to arrive before it, not after.
  //
  // Both exclusion notes sit with it, for the reason each states: a row that vanishes without a
  // count is indistinguishable from a filter that ate something real.
  const disclosure = [
    renderContentCoverage(result, crawl.pages.length),
    renderBrandExclusion(brandExcluded),
    renderFunctionWordExclusion(functionExcluded),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return {
    report: contentAuditReport(pull, crawl.fetchedAt, crawl.pages.length, result),
    text: `${disclosure}\n\n${formatContentMismatches(result)}`,
  };
}

/**
 * Build the tool. `name` is a PARAMETER for the same reason `makeAuditTool`'s is, and it is the
 * only concession this file makes to testability: a tool built under its real name reserves 12
 * credits before the handler runs, so every fast (DB-less) spec would need a database to reach
 * the logic it is asserting. The fast lane therefore drives this under a 0-credit name, and the
 * REAL name — with its real reserve, its real commit and its real release — is pinned against a
 * live stack in audit-content.db.test.ts. Neither lane can substitute for the other: the fast one
 * cannot see the ledger, and the DB one cannot enumerate every refusal cheaply.
 */
export function makeContentAuditTool(
  name: ToolName,
  deps: ContentAuditToolDeps = {},
): RegisteredTool {
  const loadPull = deps.loadPull ?? loadLatestPull;
  const loadCrawl = deps.loadCrawl ?? loadLatestCrawl;
  const loadProject = deps.loadProject ?? loadOwnProject;
  const writeRun = deps.writeRun ?? writeContentAuditRun;
  return defineTool({
    name,
    description: DESCRIPTION,
    inputSchema,
    // charge defaults to "surface": reserve -> handler -> commit / release.
    handler: async (ctx, { project_id, job_id }) => {
      // THE ARCHIVE GATE, first — before either read, because an archived project has nothing to
      // audit whatever is stored against it, and "run pull_gsc_data first" would be the wrong
      // instruction for a site the tenant removed.
      //
      // A project that does not resolve (unknown id, or another tenant's) is deliberately NOT
      // refused here: it falls through to the pull read, so another tenant's ARCHIVED project
      // answers the same NO_PULL_MESSAGE as any other id that is not yours. Answering "that
      // project is archived" would say the row EXISTS — the existence oracle project-target.ts's
      // ordering rule exists to prevent.
      const project = await loadProject(ctx.userId, project_id);
      if (project !== null && project.archivedAt !== null) {
        throw new PreconditionNotMetError(ARCHIVED_PROJECT_MESSAGE);
      }

      // THE PULL FIRST, THEN THE CRAWL, and the order is a product decision rather than an
      // accident. Search Console is the input a project is least likely to have: a crawl needs
      // only a domain, while a pull needs a connected Google account, a matched property and a
      // completed pull run. Naming the harder missing step first gives a caller who is missing
      // BOTH a next action that unblocks the tool, instead of sending them to crawl_site and
      // refusing again afterwards.
      //
      // Both loaders answer the same sentence for a missing project, another tenant's project and
      // a project that has never run the tool in question — that uniformity is what keeps project
      // existence unobservable, and it is why ownership is not checked separately here.
      const pull = await loadPull(ctx.userId, project_id);
      if (!pull.ok) throw new PreconditionNotMetError(pull.error);

      const crawl = await loadCrawl(ctx.userId, project_id, job_id);
      if (!crawl.ok) throw new PreconditionNotMetError(crawl.error);

      const rendered = renderContentAudit(pull.pull, crawl.crawl);

      // THE RUN IS RECORDED BEFORE THE REPLY IS BUILT, and the write is not guarded. withCredits
      // commits a handler that RETURNS and releases one that THROWS, so an error escaping here
      // costs the tenant nothing (audit-content-runs.ts states the same contract from the other
      // side). Caught and logged instead, the shape would be the house's worst: a charged caller,
      // a delivered report, and a panel that says the audit never ran.
      //
      // BOTH job ids are required rather than optional-and-skipped: they are optional on the two
      // load types only so DB-less fakes keep compiling, and 0026 has them NOT NULL. A report with
      // nowhere to point would otherwise become a SILENTLY unrecorded run — the one failure mode
      // this write exists to remove. Fail closed, before the reply is built.
      if (pull.jobId === undefined || crawl.jobId === undefined) {
        throw new Error(
          "audit_content: the pull or crawl load carried no job id — the run cannot be recorded",
        );
      }
      await writeRun(
        {
          userId: ctx.userId,
          projectId: project_id,
          pullJobId: pull.jobId,
          crawlJobId: crawl.jobId,
        },
        rendered.report,
      );

      // THE FOOTER, the discovery slice's lines minus the one that does not apply. The window and
      // the row cap are inherited facts about the PULL half and mean here what they mean there (an
      // absolute-threshold analysis is uninterpretable without its window; a truncated pull hides
      // queries this tool would otherwise have flagged). The crawl's own date is printed too,
      // because a mismatch is a claim about the page AS CRAWLED and a title fixed since then is
      // already repaired.
      //
      // The reauth warning is deliberately NOT here: it is the discovery tools' line about a dead
      // CONNECTION, and adding it would mean a second stored-state read on a path that has just
      // done two. The provenance line already names the action (re-run pull_gsc_data), and
      // pull_gsc_data itself refuses with the reconnect instruction when the connection is gone.
      const crawledAt =
        crawl.crawl.fetchedAt === null
          ? null
          : `Crawl data fetched ${crawl.crawl.fetchedAt.slice(0, 10)}.`;
      const footer = [
        renderAnalyzedWindow(pull.pull),
        renderRowCapCaveat(pull.pull),
        renderPullProvenance(pull.pulledAt),
        crawledAt,
      ].filter((line): line is string => line !== null);
      return textResult(`${crawlScopeLine(crawl)}\n\n${rendered.text}\n\n${footer.join("\n")}`);
    },
  });
}

export function makeAuditContentTool(deps: ContentAuditToolDeps = {}): RegisteredTool {
  return makeContentAuditTool("audit_content", deps);
}

export const auditContentTool = makeAuditContentTool();
