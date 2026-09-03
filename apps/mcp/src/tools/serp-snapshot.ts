import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { withCredits } from "../credits/guard.ts";
import { CREDIT_UNITS, TOOL_COSTS, creditsForUnits } from "../credits/costs.ts";
import {
  MAX_SERP_KEYWORDS,
  MIN_SERP_KEYWORDS,
  resolveDefaultSerpSnapshotPort,
  validateSerpKeywords,
  type SerpSnapshotPort,
  type SerpSnapshotQuery,
} from "../dfs/serp.ts";
import { checkLocationName, locationRefusalMessage } from "../dfs/locations.ts";
import { SERP_DEVICES, type TrackedDevice } from "./serp-devices.ts";
import {
  DEFAULT_DEVICE,
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_NAME,
} from "./track-keywords.ts";
import {
  loadOwnProject,
  projectIdField,
  resolveTarget,
  subjectLabel,
  targetField,
  type LoadProjectFn,
} from "./project-target.ts";
import {
  writeSerpMeasurements,
  type SerpMeasurementWriter,
} from "./serp-snapshot-store.ts";
import { formatSerpSnapshot } from "./serp-snapshot-format.ts";
import { defineTool, errorResult, textResult, type RegisteredTool, type ToolResult } from "./registry.ts";

/**
 * serp_snapshot — the MEASURING half of the rank tracker: where, if anywhere, a domain appears in
 * the organic results Google returned for each of these keywords, on this locale and this device,
 * at this moment. It is the tool that spends the DataForSEO money the free `track_keywords` records
 * a wish for and the stored-reading `keyword_positions` later charges 10 credits to read back.
 *
 * =====================================================================================
 * THE PRICE IS 5 CREDITS + 8 PER KEYWORD, AND THE CAP IS PART OF IT
 * =====================================================================================
 * The 2026-08-17 signature package (MADDE 1 row #4) prices this tool at 5 credits per call plus 8
 * per keyword, so one call costs 13 to 85. It is the FIRST price in this product with a fixed part:
 * `credits/costs.ts` carries the 8 in TOOL_COSTS and the 5 as `CREDIT_UNITS.serp_snapshot.base`,
 * and `creditsForUnits` is the only place the two are added together.
 *
 * THE KEYWORD CAP IS NOT A COMFORT LIMIT. `keyword` is singular in the vendor's own contract, so an
 * N-keyword snapshot is N paid requests and the fixed 5 amortises as N grows — the margin FALLS
 * with the count and the worst case is at the cap. Ten is the count at which the signature's own
 * "worst case 5.3x" is still true (5.27x; eleven gives 5.24x), so shipping a wider cap would price
 * a call the signature did not sign. The number lives in the port (dfs/serp.ts MAX_SERP_KEYWORDS)
 * and this schema's maximum AGREES with it rather than restating it, so the two cannot drift.
 *
 * The same cap holds the FLEET: one call reserves N x $0.02 x the safety factor against the $3.00
 * daily budget every tool shares, i.e. a tenth of the day at the cap.
 *
 * DEPTH AND SEARCH ENGINE ARE NOT INPUTS. Both are pinned in the port and both are price decisions
 * (NEVER #6): a caller-chosen depth would be a caller-chosen price, and each engine is a separate
 * vendor product. They are reported on every answer so a row says what it was measured under.
 *
 * =====================================================================================
 * NEVER #7 — THREE ANSWERS, AND NO SCORE
 * =====================================================================================
 * "Found", "searched for and not found among the results examined", and "no measurement was taken"
 * are three different answers, kept apart by the port's discriminated union, by migration 0030's
 * `status` column, and by three different sentences on the page (serp-snapshot-format.ts). An
 * absence is scoped to the results COUNTED, never to the depth asked for. Nothing here invents a
 * visibility score, a share of voice or a ranking of its own.
 *
 * charge:"handler": every refusal below — no subject, a project that is not the caller's, a keyword
 * list the port refuses, the live-disabled refusal — is returned BEFORE any reserve, so the ledger
 * is touched ZERO times (NEVER #2). Every read and every write is tenant-scoped (NEVER #4).
 *
 * IT IS USER-INVOKED ONLY. There is no scheduled refresher: unsupervised spend needs a sub-budget
 * number no human has signed (docs/plans/2026-08-24-serp-kapak-ve-cron-butcesi.md, MADDE B), so a
 * snapshot happens only because somebody asked for one.
 */

/** The per-unit price rule for this tool, read straight from the human-approved table. */
const PRICE_RULE = CREDIT_UNITS.serp_snapshot;

/** What ONE call of `keywordCount` keywords costs, derived — never a literal in prose. */
export function serpSnapshotCredits(keywordCount: number): number {
  return creditsForUnits(
    "serp_snapshot",
    PRICE_RULE,
    TOOL_COSTS.serp_snapshot,
    keywordCount,
  );
}

/**
 * THE PRICED UNIT COUNT, read off the input. Read by BOTH the registry's D17 gate (before dispatch)
 * and the handler's own reserve, so the estimate the caller would be asked to confirm and the amount
 * the ledger reserves are the same number by construction rather than by agreement.
 *
 * It is the RAW list length, which is also what `validateSerpKeywords` returns on every path that
 * reaches the reserve: that function trims but never drops, and refuses a duplicate or a blank
 * outright rather than shrinking the list. So there is no state in which the count charged is
 * smaller than the count measured.
 */
export function serpKeywordCount(input: { readonly keywords: readonly string[] }): number {
  return input.keywords.length;
}

const inputSchema = z.object({
  target: targetField("measure SERP positions for"),
  project_id: projectIdField,
  keywords: z
    .array(z.string().min(1))
    // The bounds are the PORT's own constants, not restated numbers: the maximum is part of the
    // signed price (see the header), so a schema that carried its own copy could widen the price
    // without touching the module that documents it.
    .min(MIN_SERP_KEYWORDS)
    .max(MAX_SERP_KEYWORDS)
    .describe(
      `The keywords to measure (${MIN_SERP_KEYWORDS}-${MAX_SERP_KEYWORDS}). EACH ONE IS A ` +
        "SEPARATE PAID SEARCH, so this list is what the call costs. Duplicates are refused rather " +
        "than de-duplicated — you would be billed twice for one answer — and the list is never " +
        "trimmed to fit, because a shorter answer to a longer question is not the answer you asked " +
        "for.",
    ),
  location_name: z
    .string()
    .min(1)
    .default(DEFAULT_LOCATION_NAME)
    .describe(
      `Where the search is measured, as DataForSEO names it (default "${DEFAULT_LOCATION_NAME}"). ` +
        "Results differ by country, so this is part of what the measurement means. The vendor " +
        "matches this name exactly and its spelling is sometimes not the usual English one (it " +
        'calls Turkey "Turkiye"); a name it is known not to use is refused before the reserve is ' +
        "opened, with the right one named, and costs nothing.",
    ),
  language_code: z
    .string()
    .min(2)
    .default(DEFAULT_LANGUAGE_CODE)
    .describe(`The search language (default "${DEFAULT_LANGUAGE_CODE}").`),
  device: z
    .enum(SERP_DEVICES)
    .default(DEFAULT_DEVICE)
    .describe(
      `Which SERP to measure (default "${DEFAULT_DEVICE}"). Google returns different results and a ` +
        "different layout on each, so a desktop reading says nothing about a mobile one.",
    ),
});

type SerpSnapshotInput = z.infer<typeof inputSchema>;

/**
 * The refusal when live DataForSEO access is unavailable. It describes the RULE, never which side
 * of the operator's switch this deployment is on (dfs-descriptions.test.ts pins that), and it
 * promises the free refusal because that is a real product guarantee (NEVER #2 and #7).
 */
export const NOT_ENABLED_MESSAGE =
  "serp_snapshot is not yet enabled on this deployment. Live DataForSEO access is unavailable " +
  "here, and SeoGrep never returns sample or placeholder positions as if a search engine had " +
  "really returned them. This tool will start measuring once live DataForSEO access is switched " +
  "on — you were not charged.";

const DESCRIPTION =
  "Measure where a domain appears in Google's organic results for up to " +
  `${MAX_SERP_KEYWORDS} keywords, on one location, one language and one device, and store each ` +
  "reading so keyword_positions can read it back later. Each keyword is a separate live search at " +
  "a fixed depth. Three answers are kept apart and never collapsed into a number: found (with " +
  "DataForSEO's own rank_group and rank_absolute), searched for and not found among the results " +
  "actually examined, and not measured at all. SeoGrep computes no visibility score and no " +
  "ranking of its own. Synchronous — everything comes back immediately. Costs " +
  `${TOOL_COSTS.serp_snapshot} credits, charged per keyword, plus a fixed ${PRICE_RULE.base} ` +
  `credits per call — one keyword costs ${serpSnapshotCredits(MIN_SERP_KEYWORDS)} and ` +
  `${MAX_SERP_KEYWORDS} cost ${serpSnapshotCredits(MAX_SERP_KEYWORDS)}. Needs a paid credit ` +
  "balance: it is not available on trial credits. If live DataForSEO access is unavailable on " +
  "this deployment, the tool says so and charges nothing.";

/** Dependencies — the port and the writer are injectable so specs run offline (NEVER #5). */
export interface SerpSnapshotDeps {
  readonly port?: SerpSnapshotPort;
  readonly loadProject?: LoadProjectFn;
  /**
   * The measurement recorder (default: the real `writeSerpMeasurements`). A PORT for the reason
   * every writer in this family is one: a spec can make it FAIL without breaking a database, which
   * is the only way to observe the fail-closed contract from the fast lane.
   */
  readonly writeMeasurements?: SerpMeasurementWriter;
}

export function makeSerpSnapshotTool(deps: SerpSnapshotDeps = {}): RegisteredTool {
  const writeMeasurements = deps.writeMeasurements ?? writeSerpMeasurements;
  return defineTool<SerpSnapshotInput>({
    name: "serp_snapshot",
    description: DESCRIPTION,
    inputSchema,
    charge: "handler",
    // THE PRICED UNIT COUNT for the registry's D17 gate — the same function the handler charges
    // from. At the cap the call is 85 credits, under the 200-credit threshold, so nothing is asked
    // to be confirmed; that is measured rather than assumed (serp-snapshot.test.ts).
    units: serpKeywordCount,
    handler: async (ctx: AuthContext, input): Promise<ToolResult> => {
      // Free pre-reserve gate 1 — exactly one of target / project_id, the project read
      // tenant-scoped, and an unknown id indistinguishable from another tenant's.
      const subject = await resolveTarget(ctx.userId, input, deps.loadProject ?? loadOwnProject);
      if (!subject.ok) {
        return errorResult(subject.error);
      }
      // Free pre-reserve gate 2 — the keyword list itself. The port refuses to trim, pad or
      // de-duplicate it, and its refusals are the caller's to fix; reaching them from inside the
      // reserve would charge a caller for being told their list has a duplicate in it.
      try {
        validateSerpKeywords(input.keywords);
      } catch (error) {
        return errorResult(
          `${error instanceof Error ? error.message : String(error)} You were not charged.`,
        );
      }
      // Free pre-reserve gate 3 — the location name. `track_keywords` refuses the same names at
      // registration, but this tool can be called without ever registering anything, and it is the
      // one holding the money: a name the vendor does not know comes back `40501 Invalid Field:
      // 'location_name'` AFTER the search is paid for, which is how one typo cost 13 credits and
      // $0.03 on 2026-08-25. Checked here it costs a string comparison and charges nothing.
      const badLocation = checkLocationName(input.location_name);
      if (badLocation !== null) {
        return errorResult(`${locationRefusalMessage(badLocation)} You were not charged.`);
      }
      const port = deps.port ?? resolveDefaultSerpSnapshotPort();
      // Free pre-reserve gate 4 — refuse rather than reserve credits or serve fixture positions.
      if (!port.enabled) {
        return errorResult(NOT_ENABLED_MESSAGE);
      }
      const query: SerpSnapshotQuery = {
        target_domain: subject.domain,
        keywords: input.keywords,
        location_name: input.location_name,
        language_code: input.language_code,
        device: input.device as TrackedDevice,
      };
      // THE PER-KEYWORD CHARGE. `units` is the count, never an amount: credits/costs.ts adds the
      // signed base of 5 to 8 times the count, so the reservation opened here is sized from the
      // real keyword list before any vendor request goes out. A vendor failure throws and the
      // guard releases the whole reserve.
      return withCredits(
        { userId: ctx.userId },
        // WHICH PROJECT THE SPEND IS FOR, on the ledger row itself (migration 0033) — the
        // SAME ownership-gated project the measurements below are stored under. It was
        // written to keyword_position_measurements and NOT to the ledger, so the panel and
        // the ledger disagreed about one call; undefined on a bare-target call is a REAL
        // answer ("no project scope"), never a gap (credits/guard.ts).
        {
          tool: "serp_snapshot",
          units: serpKeywordCount(input),
          projectId: subject.project?.id,
        },
        async () => {
          const snapshot = await port.fetchSerpSnapshot(query);
          // THE MEASUREMENTS ARE RECORDED BEFORE THE REPLY IS RETURNED, and the write is NOT
          // guarded (migration 0030; serp-snapshot-store.ts states the same contract from the
          // other side). withCredits commits a handler that RETURNS and releases one that THROWS,
          // so an error escaping here costs the tenant nothing. Caught and logged instead, the
          // shape would be the house's worst: a charged caller, a delivered answer, and a
          // keyword_positions that says forever that the keyword was never measured.
          await writeMeasurements(
            { userId: ctx.userId, projectId: subject.project?.id ?? null },
            snapshot.rows,
          );
          return textResult(
            formatSerpSnapshot(subjectLabel(subject.domain, subject.project), snapshot),
          );
        },
      );
    },
  });
}

/** The production serp_snapshot tool (disabled port unless DFS_LIVE=1 + credentials). */
export const serpSnapshotTool = makeSerpSnapshotTool();
