import { z } from "zod";
import { isDfsLiveEnabled, requireDataForSeoCredentials } from "../env.ts";
import { assertWithinBudget, recordSpend } from "./budget.ts";

/**
 * DataForSEO keyword-research client (mock-first).
 *
 * This is the first adapter that touches a PAID external API, so the contract is strict
 * (constitution NEVER #5): there is ZERO real DataForSEO traffic in test or CI. The client
 * is a small PORT — `KeywordResearchPort` — with three concrete shapes:
 *
 *   - createLiveClient — the real HTTP path (POST .../search_volume/live, Basic auth). It
 *     is `enabled`, and every call is wrapped by the daily budget guard (budget.ts): a
 *     pre-call gate refuses to spend past the $3/day cap, and the real per-call cost is
 *     recorded afterwards. The transport is injectable so it can be exercised WITHOUT a
 *     real network (tests pass a fake); the default wraps global fetch.
 *   - disabledPort    — `enabled: false`. resolveDefaultPort returns this whenever live is
 *     off (DFS_LIVE !== "1"). The tool checks `enabled` and returns a clear error rather
 *     than serve anything, so sample data is NEVER presented as real (NEVER #7).
 *   - createMockResearchPort — `enabled: true`, backed by a fixture. TEST-ONLY: the tool
 *     injects it in tests; production never resolves to it.
 *
 * resolveDefaultPort is the production resolver: live client when DFS_LIVE=1 AND both
 * credentials are present (a missing credential fails closed, loudly), else disabledPort.
 */

/** The DataForSEO Google Ads search-volume LIVE endpoint. */
export const DFS_SEARCH_VOLUME_ENDPOINT =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";

/**
 * Conservative per-call cost estimate (USD) used ONLY by the pre-call budget gate — a
 * deliberate over-estimate so the gate errs toward blocking. It is NOT a claim about
 * DataForSEO's price: the REAL cost is read from the response `cost` field and recorded
 * after the call (budget.ts recordSpend).
 */
export const ESTIMATED_SEARCH_VOLUME_CALL_USD = 0.1;

/** DFS success status code (both top-level and per-task). */
const DFS_OK = 20000;

/** A keyword-research request (snake_case — the tool surface passes it straight through). */
export interface SearchVolumeQuery {
  readonly keywords: string[];
  readonly language_code: string;
  readonly location_code: number;
}

/** One keyword's metrics, projected down to what the tool renders. */
export interface KeywordVolumeRow {
  readonly keyword: string;
  readonly search_volume: number | null;
  readonly cpc: number | null;
  readonly competition: string | null;
}

/**
 * The keyword-research port. `enabled` is the tool's honesty gate: when false, the tool
 * returns a clear "not enabled" error and charges nothing, instead of serving mock data.
 */
export interface KeywordResearchPort {
  readonly enabled: boolean;
  fetchSearchVolume(query: SearchVolumeQuery): Promise<KeywordVolumeRow[]>;
}

/** Minimal HTTP response shape the client needs (structurally satisfied by fetch's Response). */
export interface DfsHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Injectable HTTP transport (default wraps global fetch) — the seam that keeps tests offline. */
export type DfsTransport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<DfsHttpResponse>;

// --- Response parsing (validated with zod; the fixture is the real response shape) ------

const dfsResultRowSchema = z.object({
  keyword: z.string(),
  search_volume: z.number().nullish(),
  cpc: z.number().nullish(),
  competition: z.string().nullish(),
});

const dfsTaskSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullish(),
  result: z.array(dfsResultRowSchema).nullish(),
});

const dfsResponseSchema = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullish(),
  tasks: z.array(dfsTaskSchema).nullish(),
});

/**
 * Validate a DataForSEO search-volume response and project its first task's rows down to
 * KeywordVolumeRow[]. Throws a clear error when the top-level status or the task status is
 * not 20000 (so a paid-but-failed call never looks like empty data).
 */
export function parseSearchVolumeResponse(raw: unknown): KeywordVolumeRow[] {
  const parsed = dfsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`DataForSEO response was not in the expected shape: ${z.prettifyError(parsed.error)}`);
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
  return (task.result ?? []).map((row) => ({
    keyword: row.keyword,
    search_volume: row.search_volume ?? null,
    cpc: row.cpc ?? null,
    competition: row.competition ?? null,
  }));
}

/** The USD cost of a DFS response: top-level `cost`, else the first task's `cost`, else null. */
export function extractResponseCostUsd(raw: unknown): number | null {
  const parsed = dfsResponseSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.cost ?? parsed.data.tasks?.[0]?.cost ?? null;
}

// --- Port implementations ---------------------------------------------------------------

/**
 * A mock port backed by a canned DFS response. TEST-ONLY — the tool injects it in tests so
 * the priced path can be exercised offline. Production never resolves to this (serving a
 * fixture as real data would violate NEVER #7); resolveDefaultPort returns disabledPort
 * when live is off.
 */
export function createMockResearchPort(response: unknown): KeywordResearchPort {
  const rows = parseSearchVolumeResponse(response);
  return {
    enabled: true,
    fetchSearchVolume: async () => rows,
  };
}

/** A port that is not enabled: the tool short-circuits on `enabled`, so fetch just fails loudly. */
export function disabledPort(): KeywordResearchPort {
  return {
    enabled: false,
    fetchSearchVolume: async () => {
      throw new Error("DataForSEO live path is disabled on this deployment.");
    },
  };
}

/** Options for the live HTTP client. Credentials are passed explicitly (never read from env here). */
export interface LiveClientOptions {
  readonly login: string;
  readonly password: string;
  /** Injectable transport (default wraps global fetch) — tests pass a fake so no real HTTP runs. */
  readonly transport?: DfsTransport;
  /** Clock (defaults to Date) for the budget day + recorded ts. */
  readonly now?: () => Date;
  /** Spend directory override (tests point it at a temp dir). */
  readonly spendDir?: string;
}

const defaultTransport: DfsTransport = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

/**
 * The real (paid) DataForSEO client. Each call: (1) budget gate BEFORE spending — refuse
 * if the estimate would pass the daily cap; (2) POST the batch with Basic auth; (3) parse;
 * (4) record the REAL cost (response `cost`, else the estimate) to today's spend file.
 */
export function createLiveClient(opts: LiveClientOptions): KeywordResearchPort {
  const transport = opts.transport ?? defaultTransport;
  const now = opts.now ?? ((): Date => new Date());
  const authHeader = `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`;
  const budgetCtx = { now, dir: opts.spendDir };
  return {
    enabled: true,
    async fetchSearchVolume(query) {
      // (1) Pre-call gate — throws (and wakes the human) if this would pass the cap.
      assertWithinBudget(ESTIMATED_SEARCH_VOLUME_CALL_USD, budgetCtx);

      // (2) POST the batch.
      const response = await transport(DFS_SEARCH_VOLUME_ENDPOINT, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            keywords: query.keywords,
            language_code: query.language_code,
            location_code: query.location_code,
          },
        ]),
      });
      if (!response.ok) {
        throw new Error(`DataForSEO request failed: HTTP ${response.status}`);
      }

      // (3) Parse.
      const raw: unknown = await response.json();
      const rows = parseSearchVolumeResponse(raw);

      // (4) Record the real cost (falls back to the estimate when the response omits it).
      const actualCost = extractResponseCostUsd(raw) ?? ESTIMATED_SEARCH_VOLUME_CALL_USD;
      recordSpend(
        { cost_usd: actualCost, endpoint: DFS_SEARCH_VOLUME_ENDPOINT, count: query.keywords.length },
        budgetCtx,
      );
      return rows;
    },
  };
}

/**
 * Production port resolver. Live client ONLY when DFS_LIVE=1 AND both credentials are
 * present; a missing credential fails closed loudly (requireDataForSeoCredentials). Any
 * other state yields the disabled port, so the beta default (live off) refuses cleanly.
 */
export function resolveDefaultPort(source: NodeJS.ProcessEnv = process.env): KeywordResearchPort {
  if (!isDfsLiveEnabled(source)) {
    return disabledPort();
  }
  const { login, password } = requireDataForSeoCredentials(source);
  return createLiveClient({ login, password });
}
