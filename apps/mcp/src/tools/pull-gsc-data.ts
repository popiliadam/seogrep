import { z } from "zod";
import { decryptToken, fromByteaHex } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import { getServiceClient, type Json } from "../db.ts";
import { requireTokenEncryptionKey } from "../env.ts";
import { recordSucceededPull } from "../queue/boss.ts";
import { defaultGscApi, runPull, type GscApi } from "../gsc-data/pull.ts";
import { pullResultToJson } from "../gsc-data/types.ts";
import { formatPullSummary } from "../gsc-data/format.ts";
import { defineTool, textResult, type RegisteredTool } from "./registry.ts";

/**
 * pull_gsc_data — 5 credits, SYNC. Fetches two adjacent windows of Search Console
 * performance (current + previous `days`-day windows) for a connected project and stores
 * them for the discovery tools (find_quick_wins / detect_cannibalization /
 * analyze_content_decay) to read.
 *
 * It is a defineTool with the DEFAULT "surface" charge: reserve -> handler -> commit / release.
 * withCredits COMMITS a handler that RETURNS and RELEASES only on a THROW, so the money rule
 * is: anything that means "no pull happened" must THROW (no charge), and a stored pull must
 * RETURN (charge 5). Concretely — a missing connection, an unstored token, an unmatched
 * property, and a failed Google call all THROW (released, never charged); only a completed,
 * stored pull commits. A pull that returns zero rows is still a delivered pull and DOES
 * commit (the account genuinely has no data — the discovery tools then report "no findings").
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

/** The connection fields pull_gsc_data reads (tenant-scoped). */
export interface GscConnectionRow {
  readonly encrypted_refresh_token: string | null;
  readonly gsc_property: string | null;
}

/** Load a project's GSC connection, tenant-scoped by user_id (null when there is none). */
export type LoadConnectionFn = (
  userId: string,
  projectId: string,
) => Promise<GscConnectionRow | null>;

/** The jobs writer port (default: recordSucceededPull over the service client). */
export type RecordPullFn = (params: {
  userId: string;
  projectId: string;
  result: Json;
}) => Promise<{ jobId: string }>;

export interface PullGscDataDeps {
  /** GSC connection reader (default: tenant-scoped gsc_connections read). */
  readonly loadConnection?: LoadConnectionFn;
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
    .select("encrypted_refresh_token, gsc_property")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) {
    throw new Error(`pull_gsc_data: connection lookup failed: ${error.message}`);
  }
  return data ?? null;
};

const defaultRecordPull: RecordPullFn = (params) => recordSucceededPull(getServiceClient(), params);

/**
 * Build the pull_gsc_data tool. All I/O is injectable so the DB-integration spec can use a
 * fake Google port (zero network) over the real DB, and unit tests can fake everything.
 */
export function makePullGscDataTool(deps: PullGscDataDeps = {}): RegisteredTool {
  const loadConnection = deps.loadConnection ?? defaultLoadConnection;
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
      // All of these mean "nothing to pull" -> THROW so withCredits RELEASES (no charge).
      // A missing project and another tenant's project are indistinguishable (tenant-scoped).
      if (!connection) {
        throw new Error(
          `No Search Console connection for project ${project_id}. Run connect_gsc first.`,
        );
      }
      if (!connection.encrypted_refresh_token) {
        throw new Error(
          "This project's Search Console connection has no stored token yet. Re-run connect_gsc and approve access.",
        );
      }
      if (!connection.gsc_property) {
        throw new Error(
          "This project's Search Console connection has no matched property yet. Reconnect once the property is verified in Search Console.",
        );
      }

      const encryptionKey = deps.encryptionKey ?? requireTokenEncryptionKey();
      const refreshToken = decryptToken(fromByteaHex(connection.encrypted_refresh_token), encryptionKey);

      // A Google failure here THROWS -> released, never charged.
      const pull = await runPull({
        refreshToken,
        property: connection.gsc_property,
        days,
        reference: now(),
        api,
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
