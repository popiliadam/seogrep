import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { createDbSpendLedger, reserveSpend, settleSpend, type SpendLedger } from "./budget.ts";
import { defaultDfsTransport, DFS_REQUEST_TIMEOUT_MS, type DfsHttpResponse } from "./client.ts";

/**
 * DataForSEO **OnPage Lighthouse** adapter (mock-first) — the FIFTH paid-API port, written to the
 * same contract as client.ts, ranked-keywords.ts, backlinks.ts and competitors.ts (constitution
 * NEVER #5: ZERO real DataForSEO traffic in test or CI; the transport is injectable and the
 * production resolver returns a DISABLED port unless DFS_LIVE=1).
 *
 * WHAT IT BUYS. One Google Lighthouse run per URL, executed by the vendor's headless Chrome. The
 * vendor endpoint takes ONE `url` per request (the parameter is singular — DataForSEO's own tool
 * schema exposes `url`, not `urls`), so N pages are N requests and the cost scales with N.
 *
 * ── THE DEADLINE, and why this port does not use the shared 30 s one ────────────────────────
 *
 * `defaultDfsTransport` applies DFS_REQUEST_TIMEOUT_MS (30 s) unless a caller passes its own.
 * That constant's own comment names its purpose: give up BEFORE the platform cuts the request, so
 * WE release the slot. A Lighthouse run is not a database lookup — it is a real page load under
 * simulated throttling — and 30 s is the wrong side of plausible for it. When our deadline fires
 * mid-run the outcome is the worst one available: **the money is spent, no data comes back, and
 * the reservation stays open** (dfs/client.ts says so, and production is holding two orphaned
 * reservations that got there exactly this way).
 *
 * Three ways out were considered.
 *
 *   (a) CHOSEN — this port passes its OWN per-request deadline, and issues the ≤5 requests
 *       CONCURRENTLY so the operation's wall clock is bounded by ONE deadline instead of the sum
 *       of five. See LIGHTHOUSE_REQUEST_TIMEOUT_MS for the arithmetic; the short version is that
 *       5 x 30 s sequential = 150 s is far outside any request envelope, while 5 concurrent runs
 *       at 55 s each finish inside the same one-minute envelope the 30 s constant was picked to
 *       sit inside. It needs no new table, no queue and no second tool.
 *   (b) REJECTED for this slice — worker mode (`charge:"worker"`, the crawl_site shape): the
 *       honest answer if a live run ever proves 55 s is not enough, because an async job has no
 *       request envelope at all. It costs a jobs row, a queue handler, a persistence table for
 *       the result and a second round trip through get_job_status, which is a slice of its own —
 *       and it would also make the FIRST speed measurement a poll-and-wait, not an answer.
 *   (c) REJECTED — DataForSEO's Standard Queue (task_post + tasks_ready + task_get). Same price
 *       as live ("unified pricing for Standard Queue and Live Mode"), and it dissolves the
 *       deadline problem properly, but it needs a task-based transport lane this codebase does
 *       not have (all seven of our endpoints are `/live`) plus somewhere to park a task id
 *       between calls — i.e. it needs (b) underneath it anyway.
 *
 * If (a) turns out to be too tight against real pages, the fix is (b), NOT a larger number here:
 * past some point the request envelope is the binding constraint and no deadline can beat it.
 */

/** The DataForSEO OnPage Lighthouse LIVE endpoint. One URL per request. */
export const DFS_LIGHTHOUSE_ENDPOINT =
  "https://api.dataforseo.com/v3/on_page/lighthouse/live/json";

/**
 * How many pages ONE audit_speed call may measure. Part of the SIGNED price (operator,
 * 2026-08-17): the flat credit cost is quoted against this cap, so raising it would change the
 * price without changing the number (NEVER #6). It is also what keeps the concurrent fan-out
 * below small enough to be a fan-out rather than a load test of the vendor.
 */
export const MAX_SPEED_URLS = 5;

/**
 * DataForSEO's published price for this endpoint: a flat **$0.005 per page**, with no separate
 * per-request charge (unlike the Labs endpoints, which bill $0.012/request + $0.00012/row). Five
 * pages therefore list at $0.025.
 */
export const LIGHTHOUSE_PAGE_USD = 0.005;

/**
 * Safety factor on the pre-call ESTIMATE only, same discipline as every other port here: the gate
 * must err toward blocking, so the reservation is deliberately larger than the published price. It
 * is not a price claim — each response's REAL `cost` is read back and settles the reservation.
 */
export const BUDGET_SAFETY_FACTOR = 1.5;

/** The gate's estimate for measuring `urlCount` pages. Scales with the page count, as the price does. */
export function estimateLighthouseUsd(urlCount: number): number {
  return urlCount * LIGHTHOUSE_PAGE_USD * BUDGET_SAFETY_FACTOR;
}

/**
 * Per-request application deadline for a Lighthouse run (ms), and the reason it is not the shared
 * DFS_REQUEST_TIMEOUT_MS. The arithmetic that fixes it:
 *
 *   - The operation must finish inside the SAME request envelope every other tool call lives in.
 *     The shared 30 s constant is described as chosen to "sit inside the platform request timeout";
 *     the nearest hard edges around that are the one-minute marks that both an HTTP proxy's idle
 *     timeout and a mainstream MCP client's tool-call timeout sit at.
 *   - Requests here run CONCURRENTLY (fetchPageSpeed below), so the operation's wall clock is ONE
 *     deadline plus parse, not MAX_SPEED_URLS of them. That is the whole reason a deadline larger
 *     than 30 s is affordable at all: sequentially, 5 x 55 s = 275 s would be indefensible.
 *   - 55 s leaves headroom under that one-minute edge for TLS, JSON parse and the settle round
 *     trip, and gives one Lighthouse run ~1.8x the budget the shared constant allows.
 *
 * NOT measured against a live Lighthouse run — measuring it would mean a real paid call, which
 * NEVER #5 forbids here. It is an upper bound chosen from the envelope, not from observed run
 * times, and if live traffic shows it is too tight the answer is worker mode (see module header),
 * because a bigger number here eventually loses to the envelope itself.
 */
export const LIGHTHOUSE_REQUEST_TIMEOUT_MS = 55_000;

/**
 * A transport that accepts an OPTIONAL per-request deadline.
 *
 * `DfsTransport` (client.ts) is declared with two parameters, so a port holding one cannot pass a
 * third argument — yet `defaultDfsTransport` already ACCEPTS a `timeoutMs` and simply defaults it.
 * This alias names that third parameter without touching client.ts, and every existing two-argument
 * fake transport is still assignable to it (a function may ignore parameters it does not declare),
 * so the specs of the other four ports are unaffected.
 */
export type DfsTimedTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
  timeoutMs?: number,
) => Promise<DfsHttpResponse>;

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/**
 * The Lighthouse LAB metrics this tool reports, in the order they are printed, each keyed by its
 * Lighthouse audit id. The unit is the one Lighthouse itself documents for that audit and is used
 * ONLY as a fallback label when the vendor sent a raw `numericValue` but no formatted
 * `displayValue`; when a displayValue is present it is printed verbatim, so the reader sees the
 * vendor's own formatting rather than ours.
 *
 * Field metrics (INP, and CrUX-sourced LCP/CLS) are deliberately NOT here. Lighthouse is a LAB
 * tool: it loads the page once under simulated throttling. Printing a lab number under a field
 * metric's name would be the "measured traffic" lie compare_competitors' ETV label exists to
 * avoid — so this tool reports what Lighthouse actually produces and labels it as lab data.
 */
export const CORE_METRIC_AUDITS: readonly {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
}[] = [
  { id: "first-contentful-paint", label: "First Contentful Paint", unit: "ms" },
  { id: "largest-contentful-paint", label: "Largest Contentful Paint", unit: "ms" },
  { id: "speed-index", label: "Speed Index", unit: "ms" },
  { id: "total-blocking-time", label: "Total Blocking Time", unit: "ms" },
  { id: "cumulative-layout-shift", label: "Cumulative Layout Shift", unit: "" },
  { id: "interactive", label: "Time to Interactive", unit: "ms" },
];

/** How many improvement opportunities one page block prints, largest estimated saving first. */
export const MAX_OPPORTUNITIES = 5;

/** Which band a Core Web Vital fell in — Google's own three words, verbatim. */
export type VitalRating = "good" | "needs improvement" | "poor";

/**
 * The Core Web Vitals band boundaries — THE ONLY PLACE they are written down.
 *
 * Each pair is (upper bound of "good", upper bound of "needs improvement"), inclusive, in the unit
 * that audit's `numericValue` arrives in: milliseconds for LCP, unitless for CLS. Source, and the
 * reason this table can be checked rather than believed: web.dev/articles/vitals, read 2026-09-02
 * for the 2026-09 reference list — R-1.1 (LCP good = 2.5 s) and R-1.3 (CLS good = 0.1); the
 * "poor" boundaries (4 s and 0.25) come off the same page.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *   - **INP (R-1.2, good = 200 ms).** Not because the threshold is in doubt, but because this is a
 *     LAB tool and Lighthouse does not produce INP at all (see CORE_METRIC_AUDITS above). An entry
 *     here would be a threshold with nothing to apply it to, and the first thing a reader would
 *     conclude from its presence is that we measure INP. We do not, and cannot.
 *   - **2.0 s for LCP.** That figure circulates in SEO blogs (reference list D-1) and is
 *     CONTRADICTED by the primary source, which still says 2.5 s. It is not a rule and does not
 *     enter the code.
 *   - **A band for FCP, Speed Index, TBT or TTI.** They are diagnostics, not Core Web Vitals; the
 *     reference list carries no threshold for them, and inventing one would be exactly the
 *     fabricated-rule failure this table exists to avoid.
 *
 * These boundaries are Google's and they move on Google's cadence (R-1.6), so a change here is a
 * change to a SOURCED number: re-read the reference list first, never the other way round.
 */
export const CORE_VITAL_THRESHOLDS: Readonly<
  Record<string, { readonly good: number; readonly needsImprovement: number }>
> = {
  "largest-contentful-paint": { good: 2500, needsImprovement: 4000 },
  "cumulative-layout-shift": { good: 0.1, needsImprovement: 0.25 },
};

/**
 * Which band `numeric` falls in for the audit `id`, or null when no band can honestly be given —
 * either the metric has no published threshold (every diagnostic above) or the vendor sent no raw
 * number to compare. Null means "say nothing", never "good": an unrated metric printed as passing
 * is the same fabricated-good-news lie a zero-filled metric would be.
 */
export function rateCoreVital(id: string, numeric: number | null): VitalRating | null {
  const threshold = CORE_VITAL_THRESHOLDS[id];
  if (threshold === undefined || numeric === null) return null;
  if (numeric <= threshold.good) return "good";
  if (numeric <= threshold.needsImprovement) return "needs improvement";
  return "poor";
}

/** One reported lab metric. Absent metrics are NOT represented — see projectMetrics. */
export interface SpeedMetric {
  /** The Lighthouse audit id (`largest-contentful-paint`, …). */
  readonly id: string;
  readonly label: string;
  /** Lighthouse's own formatted value ("6.1 s"), or null when it sent only a raw number. */
  readonly display: string | null;
  /** The raw numeric value, or null when the vendor sent only a formatted string. */
  readonly numeric: number | null;
  /** The unit for the numeric fallback ("ms", or "" for unitless metrics such as CLS). */
  readonly unit: string;
}

/** One improvement opportunity Lighthouse estimates a load-time saving for. */
export interface SpeedOpportunity {
  readonly id: string;
  readonly title: string;
  /** Lighthouse's `details.overallSavingsMs` — an ESTIMATE of milliseconds saved. */
  readonly savings_ms: number;
}

/**
 * ONE page's measurement, projected down to what the tool renders.
 *
 * Every metric field is optional-by-absence rather than zero-filled: a Lighthouse run can complete
 * with a category score of null (the category errored) or without an individual audit, and writing
 * a 0 there would claim a measurement that never happened — the discipline audit/format.ts states
 * for its own signal sections.
 */
export interface PageSpeedMeasurement {
  /** The URL we asked for. */
  readonly requested_url: string;
  /** Where Lighthouse actually ended up (redirects), or null when the vendor did not say. */
  readonly final_url: string | null;
  /** When the vendor ran the measurement (raw vendor timestamp), or null. */
  readonly fetch_time: string | null;
  readonly lighthouse_version: string | null;
  /** `categories.performance.score`, 0–1. null when Lighthouse produced no score for the page. */
  readonly performance_score: number | null;
  /** Only the metrics the vendor actually returned, in CORE_METRIC_AUDITS order. */
  readonly metrics: readonly SpeedMetric[];
  /** Opportunities with a saving ABOVE zero, largest first, capped at MAX_OPPORTUNITIES. */
  readonly opportunities: readonly SpeedOpportunity[];
}

/**
 * The page-speed port. `enabled` is the tool's honesty gate: when false, the tool returns a clear
 * "not enabled" error and charges nothing, instead of serving fixture data as if it were a real
 * measurement (NEVER #7).
 */
export interface SpeedPort {
  readonly enabled: boolean;
  fetchPageSpeed(urls: readonly string[]): Promise<readonly PageSpeedMeasurement[]>;
}

// --- Response parsing (validated with zod; the fixture mirrors the Lighthouse result shape) ---

const auditSchema = z.object({
  id: z.string().nullish(),
  title: z.string().nullish(),
  score: z.number().nullish(),
  numericValue: z.number().nullish(),
  displayValue: z.string().nullish(),
  details: z
    .object({
      type: z.string().nullish(),
      overallSavingsMs: z.number().nullish(),
    })
    .nullish(),
});

type RawAudit = z.infer<typeof auditSchema>;

/**
 * The Lighthouse result, kept deliberately loose. Every field is nullish because a Lighthouse run
 * degrades in pieces: a page can score on some categories and not others, an audit can be marked
 * not-applicable and carry no numbers, and a strict schema would throw away a PAID measurement
 * because one optional field was missing.
 *
 * THE KEYS ARE camelCase, and that is the fix for B-1 rather than a style choice. A Lighthouse
 * result (LHR) is a Lighthouse document that DataForSEO passes through verbatim, so the ENVELOPE
 * around it is snake_case — `status_code`, `tasks`, `result` — while the result INSIDE it keeps
 * Lighthouse's own casing. The vendor's own documented example carries `lighthouseVersion`,
 * `requestedUrl`, `mainDocumentUrl`, `finalDisplayedUrl`, `finalUrl` and `fetchTime`
 * (https://docs.dataforseo.com/v3/on_page/lighthouse/live/json/, read 2026-09-02); only the
 * REQUEST parameters (`url`, `for_mobile`, …) are snake_case.
 *
 * This schema used to ask for the snake_case names, so all four fields parsed as null on every
 * live call: the provenance line was never printed once in production, and a redirect could not
 * be detected at all — a redirected page's numbers were reported under the URL that was asked
 * for. The fixture asked for the same wrong names, so the whole suite stayed green over it
 * (signed lesson 12: a double more forgiving than the real runtime turns a missing field into a
 * PASSING test).
 *
 * The snake_case names are kept as ALIASES rather than deleted. They are not a claim that anyone
 * sends them — nothing observed does — they are one line each of insurance against throwing away
 * a measurement the customer already paid for, and the camelCase key wins whenever both appear.
 */
const lighthouseResultSchema = z.object({
  lighthouseVersion: z.string().nullish(),
  requestedUrl: z.string().nullish(),
  finalUrl: z.string().nullish(),
  fetchTime: z.string().nullish(),
  // Transition aliases — see the note above. Never preferred over the camelCase key.
  lighthouse_version: z.string().nullish(),
  requested_url: z.string().nullish(),
  final_url: z.string().nullish(),
  fetch_time: z.string().nullish(),
  categories: z
    .object({
      performance: z.object({ score: z.number().nullish() }).nullish(),
    })
    .nullish(),
  audits: z.record(z.string(), auditSchema).nullish(),
});

const envelopeSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullish(),
  tasks: z
    .array(
      z.object({
        status_code: z.number(),
        status_message: z.string().optional(),
        cost: z.number().nullish(),
        result: z.array(z.unknown()).nullish(),
      }),
    )
    .nullish(),
});

/**
 * Validate the shared DataForSEO envelope and return the first task's first result. Throws a clear
 * error when the top-level status or the task status is not 20000, so a paid-but-failed run never
 * reaches the reader as "this page has no metrics".
 */
function unwrapFirstResult(raw: unknown): unknown {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO response was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const response = parsed.data;
  if (response.status_code !== DFS_OK) {
    throw new Error(
      `DataForSEO returned an error status ${response.status_code}: ${response.status_message ?? "unknown"}`,
    );
  }
  const task = response.tasks?.[0];
  if (!task) {
    throw new Error("DataForSEO response contained no task.");
  }
  if (task.status_code !== DFS_OK) {
    throw new Error(
      `DataForSEO task failed (status ${task.status_code}): ${task.status_message ?? "unknown"}`,
    );
  }
  return task.result?.[0] ?? null;
}

/**
 * The metrics the vendor ACTUALLY returned, in CORE_METRIC_AUDITS order.
 *
 * An audit that is absent, or present with neither a formatted nor a numeric value, contributes
 * NOTHING — not a zero, not an "n/a" row. A missing Speed Index means Lighthouse did not measure
 * it on this page, and a line reading "Speed Index: 0 ms" would be a fabricated measurement of the
 * best possible kind, which is the most misleading direction available.
 */
function projectMetrics(audits: Readonly<Record<string, RawAudit>>): readonly SpeedMetric[] {
  return CORE_METRIC_AUDITS.flatMap((metric) => {
    const audit = audits[metric.id];
    if (!audit) return [];
    const display = audit.displayValue ?? null;
    const numeric = audit.numericValue ?? null;
    if (display === null && numeric === null) return [];
    return [{ id: metric.id, label: metric.label, display, numeric, unit: metric.unit }];
  });
}

/**
 * The improvement opportunities, largest estimated saving first, capped.
 *
 * Three filters, all deliberate. `details.type === "opportunity"` is Lighthouse's own marker for
 * "this audit estimates a load-time saving" — every other audit type (debugdata, table, …) carries
 * no such estimate and would be listed under a heading that promises one. And a saving of zero is
 * dropped: Lighthouse emits passing opportunity audits with `overallSavingsMs: 0`, and printing
 * them as "opportunities" would pad the list with things already done.
 *
 * The THIRD is B-7, and the reason the rule above was stated correctly but enforced by half. A
 * PASSING opportunity audit does not always carry a zero saving: Lighthouse scores it 1, flips its
 * title to the past tense, and keeps the estimate. Measured live on 2026-09-02 — "Initial server
 * response time was short — an estimated 180 ms saved" printed under "Biggest opportunities", i.e.
 * a completed item listed as work to do. `score` was already parsed here and simply never read.
 *
 * The boundary is `score === 1` — PASSED — not a threshold near it. An audit scored 0.99 is not
 * passed, and an audit the vendor did not score at all is UNJUDGED rather than done: dropping
 * either would hide a real saving, which is the more expensive direction to be wrong in.
 */
function projectOpportunities(
  audits: Readonly<Record<string, RawAudit>>,
): readonly SpeedOpportunity[] {
  return Object.entries(audits)
    .flatMap(([key, audit]) => {
      if (audit.details?.type !== "opportunity") return [];
      if (audit.score === 1) return [];
      const savings = audit.details.overallSavingsMs ?? null;
      if (savings === null || savings <= 0) return [];
      return [{ id: audit.id ?? key, title: audit.title ?? (audit.id ?? key), savings_ms: savings }];
    })
    .sort((a, b) => b.savings_ms - a.savings_ms)
    .slice(0, MAX_OPPORTUNITIES);
}

/**
 * Project ONE Lighthouse response down to a PageSpeedMeasurement. `requestedUrl` is what WE asked
 * for and is used when the vendor echoes nothing back, so a page block is always attributable to
 * the URL the caller paid to measure.
 */
export function parseLighthouseResponse(raw: unknown, requestedUrl: string): PageSpeedMeasurement {
  const result = unwrapFirstResult(raw);
  if (result === null || result === undefined) {
    throw new Error(`DataForSEO returned no Lighthouse result for ${requestedUrl}.`);
  }
  const parsed = lighthouseResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `DataForSEO Lighthouse result was not in the expected shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  const lhr = parsed.data;
  const audits = lhr.audits ?? {};
  return {
    requested_url: lhr.requestedUrl ?? lhr.requested_url ?? requestedUrl,
    final_url: lhr.finalUrl ?? lhr.final_url ?? null,
    fetch_time: lhr.fetchTime ?? lhr.fetch_time ?? null,
    lighthouse_version: lhr.lighthouseVersion ?? lhr.lighthouse_version ?? null,
    performance_score: lhr.categories?.performance?.score ?? null,
    metrics: projectMetrics(audits),
    opportunities: projectOpportunities(audits),
  };
}

/** The USD cost of a Lighthouse response: top-level `cost`, else the first task's, else null. */
export function extractLighthouseCostUsd(raw: unknown): number | null {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ------------------------------------------------------------------

/**
 * A mock port backed by canned Lighthouse responses keyed by URL, with a `default` entry answering
 * any URL that has none. TEST-ONLY — the tool injects it in tests so the priced path can be
 * exercised offline. Production never resolves to it (serving a fixture as a real measurement
 * would violate NEVER #7); resolveDefaultSpeedPort returns the disabled port when live is off.
 */
export function createMockSpeedPort(
  responses: Readonly<Record<string, unknown>>,
): SpeedPort {
  return {
    enabled: true,
    fetchPageSpeed: async (urls) =>
      urls.map((url) => {
        const raw = responses[url] ?? responses.default;
        if (raw === undefined) {
          throw new Error(`No Lighthouse fixture for "${url}" (add it, or a "default").`);
        }
        return parseLighthouseResponse(raw, url);
      }),
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledSpeedPort(): SpeedPort {
  return {
    enabled: false,
    fetchPageSpeed: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveSpeedOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTimedTransport;
  /** Injectable spend counter (defaults to the DB-backed one) — specs pass a fake. */
  readonly ledger?: SpendLedger;
  /** Per-request deadline override (default LIGHTHOUSE_REQUEST_TIMEOUT_MS) — specs shrink it. */
  readonly timeoutMs?: number;
}

/**
 * The real (paid) Lighthouse client. Per lookup: (1) ONE reservation sized to the page count,
 * BEFORE any HTTP; (2) one request PER URL, all issued CONCURRENTLY (see the module header — the
 * fan-out is what keeps the whole operation inside one deadline rather than N of them); (3) ONE
 * settlement with the real total once every request has come back.
 *
 * Any request failing fails the whole lookup, and the reservation is then left OPEN at its
 * estimate — the same conservative choice competitors.ts makes, and here it is the only sound one:
 * a run that timed out may still have been billed by the vendor, so settling at "the cost of the
 * responses we got" would UNDER-count the day. The estimate is never less than the real spend
 * (LIGHTHOUSE_PAGE_USD x pages x margin), so the budget errs toward refusing the next call.
 *
 * `allSettled`, not `all`: a rejection from `all` leaves its siblings' rejections unhandled, and an
 * unhandled rejection in a request-scoped fan-out is a process-level hazard, not a test artefact.
 */
export function createLiveSpeedClient(opts: LiveSpeedOptions): SpeedPort {
  const transport = opts.transport ?? defaultDfsTransport;
  const timeoutMs = opts.timeoutMs ?? LIGHTHOUSE_REQUEST_TIMEOUT_MS;
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const ledger = opts.ledger ?? createDbSpendLedger();

  /** One page's measurement plus what the vendor actually charged for it. */
  async function measure(url: string): Promise<{ page: PageSpeedMeasurement; costUsd: number }> {
    const response = await transport(
      DFS_LIGHTHOUSE_ENDPOINT,
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        // `enable_javascript` is pinned explicitly rather than left to the vendor default: a
        // performance measurement of a page whose scripts never ran is a measurement of a
        // different page, and D9's discipline is that a flag which silently changes the result is
        // stated, never inherited.
        body: JSON.stringify([{ url, enable_javascript: true }]),
      },
      timeoutMs,
    );
    if (!response.ok) {
      throw new Error(`DataForSEO request failed: HTTP ${response.status} (${url})`);
    }
    const raw: unknown = await response.json();
    const page = parseLighthouseResponse(raw, url);
    return { page, costUsd: extractLighthouseCostUsd(raw) ?? LIGHTHOUSE_PAGE_USD };
  }

  return {
    enabled: true,
    async fetchPageSpeed(urls) {
      // (1) ONE reservation for the whole operation — throws (and wakes the human) at the cap or
      // when the counter is unreadable, before a single request goes out.
      const reservation = await reserveSpend(
        estimateLighthouseUsd(urls.length),
        DFS_LIGHTHOUSE_ENDPOINT,
        ledger,
      );

      // (2) The concurrent fan-out.
      const settled = await Promise.allSettled(urls.map((url) => measure(url)));
      const failure = settled.find((outcome) => outcome.status === "rejected");
      if (failure && failure.status === "rejected") {
        // Reservation deliberately left OPEN at its estimate — see the doc comment above.
        throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
      }
      const results = settled.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : [],
      );

      // (3) Settle once with the real total.
      const costUsd = results.reduce((sum, entry) => sum + entry.costUsd, 0);
      await settleSpend(reservation, costUsd, results.length, ledger);
      return results.map((entry) => entry.page);
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are present;
 * a missing credential fails closed loudly (requireDataForSeoCredentials). Any other state yields
 * the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultSpeedPort(source: NodeJS.ProcessEnv = process.env): SpeedPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledSpeedPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveSpeedClient({ login, password });
}

/** Re-exported so specs can assert this port's deadline is NOT the shared 30 s one. */
export { DFS_REQUEST_TIMEOUT_MS };
