import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { TOOL_COSTS } from "../credits/costs.ts";
import { withNoChargeNote } from "../credits/free-refusal.ts";
import {
  CORE_VITAL_THRESHOLDS,
  MAX_SPEED_URLS,
  rateCoreVital,
  resolveDefaultSpeedPort,
  type PageSpeedMeasurement,
  type SpeedOpportunity,
  type SpeedPort,
} from "../dfs/lighthouse.ts";
import { normalizeDomain } from "./setup-project.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * audit_speed — how fast a handful of pages actually load, measured by Google Lighthouse through
 * DataForSEO's OnPage API. Synchronous: the table comes back immediately, no background job.
 *
 * It is the speed-shaped hole in our own audit family: audit_onpage, audit_tech and audit_schema
 * all read a stored crawl, and a crawl records how long OUR fetch took — not how long a browser
 * takes to render the page. This tool is the only one that answers the second question, which is
 * also the only one Core Web Vitals is about.
 *
 * It takes URLs, not a project: a Lighthouse run measures a PAGE, and which pages matter is the
 * caller's judgement, not something derivable from a crawl. That is also why it stores nothing —
 * see the persistence note at the end of this comment.
 *
 * The same two hard product rules that shape every DataForSEO tool shape its credit path:
 *   1. Live DataForSEO data is OFF by default (beta). While off, the tool returns a clear English
 *      error and NEVER serves sample figures as if they were a real measurement (NEVER #7). The
 *      fixtures exist only for tests.
 *   2. That live-disabled error — and every invalid-input rejection — is returned BEFORE any
 *      credit reserve, so the ledger is touched ZERO times (NEVER #2).
 *
 * charge:"handler" for the same reason analyze_backlinks and compare_competitors use it: this is a
 * SYNCHRONOUS tool that must run gates BEFORE the reserve, which charge:"surface"
 * (reserve-then-handler) cannot express. On the serving path it settles via withCredits WITHOUT a
 * jobId — the exact SURFACE ledger shape (reserve -> commit, a traceability uuid, no jobs row).
 *
 * One call is up to MAX_SPEED_URLS paid Lighthouse requests. The port throws unless ALL of them
 * succeed, so a partial table is never billed: withCredits releases the reserve and the caller's
 * balance ends where it started, whichever page failed.
 *
 * NO PERSISTENCE IN THIS SLICE, deliberately. `audit_runs` (migration 0024) is the natural-looking
 * home and it does not fit: its `crawl_job_id` is NOT NULL because — in that migration's own words
 * — an audit there is a rule engine running over a specific crawl, and comparing two runs only
 * means anything if you know which crawls they read. audit_speed reads no crawl at all; it takes
 * URLs and asks the vendor. Writing a synthetic crawl id to satisfy the column would turn the
 * column's name into a lie, and the `tool` CHECK constraint refuses the row anyway. A speed run
 * needs its own table with its own axes (URL, not project-plus-crawl), which is a migration and
 * therefore its own slice.
 */

const NOT_ENABLED_MESSAGE =
  "Page speed measurements are not yet enabled on this deployment. Live DataForSEO data is turned " +
  "off, and SeoGrep never returns sample or placeholder figures as if they were a real " +
  "measurement. This tool will start returning data once live DataForSEO access is switched on — " +
  "you were not charged.";

const inputSchema = z.object({
  urls: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_SPEED_URLS)
    .describe(
      `The page URLs to measure — between 1 and ${MAX_SPEED_URLS} of them. Each one is a full ` +
        'page URL such as "https://example.com/pricing"; a bare domain is read as its https ' +
        "home page. Every URL is measured by its own Lighthouse run, so pick the pages that " +
        "matter (home, a key landing page, a product page) rather than the whole site.",
    ),
});

type AuditSpeedInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Measure how fast pages load with Google Lighthouse: the performance score, the lab Core Web " +
  "Vitals (LCP, CLS, Total Blocking Time and the rest), and the biggest estimated load-time " +
  `savings for each page. Takes 1–${MAX_SPEED_URLS} page URLs and measures each one separately. ` +
  "These are LAB measurements — one simulated page load each, not field data from real visitors. " +
  `Synchronous — returns the table immediately. Costs ${TOOL_COSTS.audit_speed} credits. Needs a ` +
  "paid credit balance: it is not available on trial credits. If live DataForSEO access is " +
  "unavailable on this deployment, the tool says so and charges nothing.";

/**
 * Group digits with commas without depending on ICU/locale data (deterministic). Kept local for
 * the same reason compare_competitors keeps its own: sharing it would mean editing tools whose
 * rendered output is pinned byte-for-byte.
 */
function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A canonical URL, or the reason it was refused. */
export type NormalizedSpeedUrl =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: string };

/**
 * A leading URL scheme, if the input carries one.
 *
 * `(?!\d)` is what separates a SCHEME from a host:PORT. Without it, `slowshop.org:8080/pricing`
 * reads as the scheme "slowshop.org" and a perfectly ordinary URL is refused; with it, the only
 * inputs treated as scheme-bearing are the ones whose colon is followed by something that is not
 * a port number. `://` alone is not enough to detect a scheme either — `javascript:`, `data:` and
 * `mailto:` carry no authority, and one of those (`mailto:user@example.org`) parses into a VALID
 * https URL once a scheme is prepended, i.e. it would quietly be measured as someone's domain.
 */
const URL_SCHEME_RE = /^([a-z][a-z0-9+.-]*):(?!\d)/i;

/** The two schemes a page-speed measurement can mean anything for. */
const MEASURABLE_SCHEMES: ReadonlySet<string> = new Set(["http", "https"]);

/**
 * Canonicalize ONE page URL.
 *
 * A bare host is read as its https home page — the same convenience normalizeDomain offers — but
 * the PATH is kept, because a page URL is the whole point here. Two refusals, both free:
 *   - a scheme other than http/https. Checked on the RAW input rather than on the parse result,
 *     for the reason URL_SCHEME_RE documents.
 *   - a host normalizeDomain refuses. That is the ONE public-hostname gate both runtimes share
 *     (@pseo/core net/hostname), so `localhost`, `foo.internal` and every reserved pseudo-TLD are
 *     rejected here with the same word every other tool uses — before any credit is reserved and
 *     before an internal name can be handed to a third party to fetch.
 */
export function normalizeSpeedUrl(raw: string): NormalizedSpeedUrl {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: "A page URL is required (received an empty value)." };
  }
  const scheme = URL_SCHEME_RE.exec(trimmed)?.[1]?.toLowerCase() ?? null;
  if (scheme !== null && !MEASURABLE_SCHEMES.has(scheme)) {
    return {
      ok: false,
      error: `"${raw}" is not a web page URL — only http and https addresses can be measured.`,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(scheme === null ? `https://${trimmed}` : trimmed);
  } catch {
    return { ok: false, error: `"${raw}" is not a valid page URL.` };
  }
  // Belt and braces: the raw-input check above is the one that catches the schemeless forms, and
  // this one is what a redirect of that rule past the parse would still have to satisfy.
  if (!MEASURABLE_SCHEMES.has(parsed.protocol.replace(/:$/, ""))) {
    return {
      ok: false,
      error: `"${raw}" is not a web page URL — only http and https addresses can be measured.`,
    };
  }
  const host = normalizeDomain(parsed.hostname);
  if (!host.ok) {
    return { ok: false, error: host.error };
  }
  return { ok: true, url: parsed.toString() };
}

/** A normalized URL list, or the first rejection reason. */
export type NormalizedSpeedUrls =
  | { readonly ok: true; readonly urls: readonly string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Canonicalize the caller's URL list. The first invalid URL rejects the whole call (free,
 * pre-reserve), and repeats are dropped: measuring the same page twice in one call buys the same
 * answer twice and costs a second Lighthouse run to do it. De-duplication happens AFTER
 * canonicalization, so "example.com" and "https://example.com/" are recognised as one page.
 */
export function normalizeSpeedUrls(raw: readonly string[]): NormalizedSpeedUrls {
  let urls: readonly string[] = [];
  for (const entry of raw) {
    const normalized = normalizeSpeedUrl(entry);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    if (urls.includes(normalized.url)) continue;
    urls = [...urls, normalized.url];
  }
  return { ok: true, urls };
}

/** Lighthouse's 0–1 category score as the 0–100 figure Lighthouse itself displays. */
function scoreOutOf100(score: number): number {
  return Math.round(score * 100);
}

/**
 * One metric line: the vendor's own formatting when it sent any, else the raw number with the
 * unit Lighthouse documents for that audit — or NULL when there is nothing to print.
 *
 * The null branch is the second half of a rule the parser already enforces (projectMetrics drops a
 * value-less audit), and it is deliberately duplicated rather than assumed. The obvious shape here
 * — `thousands(metric.numeric ?? 0)` — turns "the vendor measured nothing" into "0 ms", which on a
 * speed report is not a missing value but a perfect score. A rule whose only enforcement is one
 * `if` in one file is a rule one refactor away from producing that line.
 */
function renderMetric(metric: PageSpeedMeasurement["metrics"][number]): string | null {
  const value =
    metric.display !== null
      ? metric.display
      : metric.numeric === null
        ? null
        : metric.unit === ""
          ? String(metric.numeric)
          : `${thousands(metric.numeric)} ${metric.unit}`;
  if (value === null) return null;
  return `  - ${metric.label}: ${value}${renderBand(metric)}`;
}

/**
 * The Core Web Vitals band for a metric line, or "" when none can honestly be given (B-4).
 *
 * WHY IT IS HERE AT ALL. Measured live 2026-09-02: LCP 2.9 s and LCP 2.4 s were printed in exactly
 * the same voice, so a reader could not tell from the output that one of them was over Google's
 * 2.5 s line and the other under it. A number with no band is a number the customer has to look up
 * to use.
 *
 * The BOUNDARY IS FORMATTED FROM THE SAME CONSTANT the verdict is computed from, never retyped
 * beside it: a second copy of "2.5 s" in a sentence is a second thing to update when Google moves
 * the line (R-1.6 says it moves on an annual cadence), and the copy that is not updated is the one
 * the customer reads. `rateCoreVital` answers null for every metric with no published threshold —
 * and for INP, which a lab tool cannot produce — so this appends nothing rather than inventing a
 * rule.
 */
function renderBand(metric: PageSpeedMeasurement["metrics"][number]): string {
  const rating = rateCoreVital(metric.id, metric.numeric);
  if (rating === null) return "";
  const good = CORE_VITAL_THRESHOLDS[metric.id]?.good;
  if (good === undefined) return "";
  const bound = metric.unit === "" ? String(good) : `${thousands(good)} ${metric.unit}`;
  return ` — ${rating} (good is ${bound} or less)`;
}

/** One opportunity line, with the ESTIMATED saving Lighthouse attached to it. */
function renderOpportunity(opportunity: SpeedOpportunity): string {
  return `  - ${opportunity.title} — an estimated ${thousands(opportunity.savings_ms)} ms saved`;
}

/**
 * The provenance line: WHEN the measurement was taken, by WHICH Lighthouse, and where it ended up.
 *
 * Assembled from the parts the vendor actually sent, and omitted entirely when it sent none —
 * rather than printing "measured (unknown) with Lighthouse (unknown)", which reads as a defect in
 * the tool instead of as a gap in the response. The final URL appears only when it DIFFERS from
 * what was asked for, because a redirect changes which page the numbers describe.
 */
function renderProvenance(page: PageSpeedMeasurement): readonly string[] {
  const parts: string[] = [];
  if (page.fetch_time !== null) parts.push(`measured ${page.fetch_time}`);
  if (page.lighthouse_version !== null) parts.push(`Lighthouse ${page.lighthouse_version}`);
  if (page.final_url !== null && page.final_url !== page.requested_url) {
    parts.push(`redirected to ${page.final_url}`);
  }
  return parts.length === 0 ? [] : [`  (${parts.join(" · ")})`];
}

/**
 * ONE page's block.
 *
 * Every section is printed ONLY when the vendor supplied it — the discipline audit/format.ts
 * states for its own signal sections, and it matters more here than anywhere else in the codebase:
 * a speed report is read as a scorecard, and a fabricated zero on a speed axis is the one lie that
 * reads as GOOD news. A page with no score says so in words; a metric Lighthouse did not measure
 * has no line at all; a page with no opportunities gets no opportunities heading.
 */
function renderPage(page: PageSpeedMeasurement): string {
  const lines: string[] = [`• ${page.requested_url}`, ...renderProvenance(page)];
  lines.push(
    page.performance_score === null
      ? "  Performance score: Lighthouse returned no score for this page."
      : `  Performance score: ${scoreOutOf100(page.performance_score)} / 100`,
  );
  lines.push(
    ...page.metrics.flatMap((metric) => {
      const line = renderMetric(metric);
      return line === null ? [] : [line];
    }),
  );
  if (page.opportunities.length > 0) {
    lines.push("  Biggest opportunities, by estimated load-time saving:");
    lines.push(...page.opportunities.map(renderOpportunity));
  }
  return lines.join("\n");
}

/**
 * Render the measurement as the plain-text tool output (pure — unit-tested directly).
 *
 * The heading states what kind of measurement this is before any number is read. Lighthouse loads
 * the page ONCE under simulated throttling; it is not what real visitors experienced, and a report
 * that let the reader assume otherwise would be the same class of claim as calling an estimated
 * traffic figure "traffic".
 *
 * It carries three qualifications, and each one was earned by a live measurement on 2026-09-02:
 *
 *   DESKTOP (B-9). The vendor's `for_mobile` parameter defaults to false, so every run this tool
 *   has ever bought was a desktop one — and the output used to say nothing about it, while
 *   mobile-first indexing (R-3.14) means a mobile-first audience is reading numbers from the wrong
 *   device. Measuring mobile as well would double the vendor cost per call, and MAX_SPEED_URLS is
 *   part of the SIGNED price, so that is a price decision (NEVER #6) and not this slice's to make.
 *   What is this slice's to do is stop the silence.
 *
 *   ONE SAMPLE (B-2). The same page, measured twice two minutes apart, came back 74 then 84, with
 *   Speed Index 3.5 s then 1.6 s and LCP 2.9 s then 2.4 s — a spread that straddles the very 2.5 s
 *   band the metric lines now print. A single lab run is a diagnostic sample, and a reader given
 *   bands without that sentence would read a coin flip as a verdict.
 *
 *   FIELD DATA IS THE RANKING SIGNAL (R-1.4/R-1.7). Core Web Vitals as Google uses them are field
 *   data at the 75th percentile of real visits. This tool does not read them and does not claim
 *   to; saying which measurement is missing is the honest half of printing the one we have.
 */
export function formatSpeedAudit(pages: readonly PageSpeedMeasurement[]): string {
  const heading =
    `Page speed — ${pages.length} page(s) measured with Google Lighthouse, as a desktop run: ` +
    "mobile is not measured. These are LAB measurements: one simulated page load each, not field " +
    "data from real visitors. Each figure is a single sample and moves between runs — the same " +
    "page can score tens of points apart minutes apart — so read one run as a signal, not a " +
    "verdict, and re-run before acting on a borderline number. The Core Web Vitals Google ranks " +
    "on are field data at the 75th percentile of real visits, which this tool does not read.";
  return [heading, ...pages.map(renderPage)].join("\n\n");
}

/** Dependencies — the speed port is injectable so tests run offline (mock/disabled). */
export interface AuditSpeedDeps {
  /**
   * The page-speed port. Defaults to the env-resolved port each call: a live client when
   * DFS_LIVE=1 AND credentials are present, otherwise a disabled port. Tests inject a mock (to
   * exercise the priced path) or a disabled port (to prove the honesty gate).
   */
  readonly port?: SpeedPort;
}

export function makeAuditSpeedTool(deps: AuditSpeedDeps = {}): RegisteredTool {
  return defineTool<AuditSpeedInput>({
    name: "audit_speed",
    description: DESCRIPTION,
    inputSchema,
    // See the module header: a self-settled SYNCHRONOUS surface charge, not an async job.
    charge: "handler",
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — the URL cap itself lives in the zod schema above, so a call
      // naming more than MAX_SPEED_URLS pages is refused by the registry before this handler runs
      // at all. The cap is part of the signed price (NEVER #6), not a soft limit.
      //
      // Free pre-reserve gate 2 — canonicalize every URL. The first bad one rejects the whole
      // call, free, and an internal or non-http address never reaches the vendor.
      const urls = normalizeSpeedUrls(input.urls);
      if (!urls.ok) {
        // A rejected URL is a free refusal like every other gate in this handler — it returns
        // before withCredits opens the 15-credit reserve — so it says so, in the same words
        // NOT_ENABLED_MESSAGE below already uses.
        return errorResult(withNoChargeNote(urls.error));
      }
      const port = deps.port ?? resolveDefaultSpeedPort();
      // Free pre-reserve gate 3 — refuse rather than reserve credits or serve fixture data.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      // Serving path: settle synchronously at the surface (no jobId) — reserve -> measure ->
      // commit as one chain. Any Lighthouse run failing throws, so withCredits releases and a
      // partial table is never billed.
      return withCredits({ userId: ctx.userId }, { tool: "audit_speed" }, async () => {
        const pages = await port.fetchPageSpeed(urls.urls);
        return textResult(formatSpeedAudit(pages));
      });
    },
  });
}

/** The production audit_speed tool (env-resolved port: disabled unless DFS_LIVE=1 + creds). */
export const auditSpeedTool = makeAuditSpeedTool();
