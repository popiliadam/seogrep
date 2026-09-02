import { z } from "zod";
// A module with no imports of its own — a pure table of vendor spellings — so reading it here
// leaves this free tool exactly where it was in the vendor-spend import graph
// (credits/paid-balance.graph.test.ts), which is: nowhere near it.
import { checkLocationName, locationRefusalMessage } from "../dfs/locations.ts";
import { SERP_DEVICES, type TrackedDevice } from "./serp-devices.ts";
import {
  loadOwnProject,
  projectNotFoundMessage,
  ARCHIVED_PROJECT_MESSAGE,
  type LoadProjectFn,
} from "./project-target.ts";
import {
  MAX_TRACKED_KEYWORDS_PER_PROJECT,
  countActiveTrackedKeywords,
  listActiveTrackedKeywords,
  loadTrackedKeywords,
  normalizeKeywordList,
  trackKeywords,
  untrackKeywords,
  type ActiveTrackedKeyword,
  type CountActiveTrackedFn,
  type ListActiveTrackedFn,
  type LoadTrackedFn,
  type TrackKeywordsFn,
  type UntrackKeywordsFn,
} from "./tracked-keywords-store.ts";
import { defineTool, errorResult, textResult, type RegisteredTool } from "./registry.ts";

/**
 * track_keywords — the registration half of the rank tracker: which keywords a project wants
 * watched, on which locale and which device. 0 credits: it calls no paid API, takes no
 * measurement, and never touches the ledger (NEVER #2 — and the credit guard short-circuits at
 * cost 0 before any reserve, so there is not even a ledger round trip to make).
 *
 * ANCHORED ON track_gsc_property's SHAPE, and the three things it borrows are the three that
 * matter: the write is IDEMPOTENT (asking twice is one row, not a duplicate), un-registration is
 * an ARCHIVE STAMP rather than a delete (untrack_project's rule at keyword grain — re-tracking
 * revives the SAME row, so "since when have I watched this" survives), and every read and write is
 * tenant-scoped on a service-role client that bypasses RLS (NEVER #4).
 *
 * =====================================================================================
 * A TRACKED KEYWORD CARRIES ITS LOCALE AND ITS DEVICE
 * =====================================================================================
 * "seo tools" on the US desktop SERP and "seo tools" on the UK mobile SERP are two different
 * questions with two different answers — the SERP port says so in the sentence it ships to callers
 * (the port's DEVICE_MEANS: "Measured on the desktop SERP only … this says nothing about a mobile ranking").
 * So the locale and the device are part of what is tracked, not something chosen later when a
 * measurement is taken: a subscription that named neither would leave nothing to measure and would
 * fuse two series into one. The cost is stated rather than hidden — tracking one keyword on two
 * devices is TWO tracked keywords and counts twice against the cap.
 *
 * =====================================================================================
 * IT MEASURES NOTHING, AND SAYS SO
 * =====================================================================================
 * Registering a keyword records a standing request. It does not go to Google, does not spend
 * vendor money, and does not create a position — a SERP snapshot does that, separately and for a
 * price. Every answer below says which of the two just happened, because "tracked" reading as
 * "measured" is exactly the confusion a free registration tool invites (NEVER #7).
 */

/** United States — the SERP wrapper's own documented default `location_name`. */
export const DEFAULT_LOCATION_NAME = "United States";

/** English — the same default every sibling tool takes for `language_code`. */
export const DEFAULT_LANGUAGE_CODE = "en";

/** The device measured when the caller does not say. Desktop, matching the vendor's own default. */
export const DEFAULT_DEVICE: TrackedDevice = "desktop";



/**
 * What the caller asks this tool to do. Two verbs and a READ, on one registration surface.
 *
 * `list` is here rather than in a `list_tracked_keywords` of its own because it answers a question
 * about exactly this tool's subject, and a caller who has just registered something asks it in the
 * same breath. Measured 2026-09-02: there was no read at all on the MCP surface — the only way to
 * find out what a project tracked was to WRITE the same list again, which this tool's own error
 * text actually recommended.
 */
export const TRACK_ACTIONS = ["track", "untrack", "list"] as const;
export type TrackAction = (typeof TRACK_ACTIONS)[number];

const inputSchema = z.object({
  project_id: z
    .uuid()
    .describe(
      "The project these keywords belong to (from list_projects). Tracking is per project: the " +
        "domain whose ranking is being watched is the project's.",
    ),
  keywords: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_TRACKED_KEYWORDS_PER_PROJECT)
    .optional()
    .describe(
      `The keywords to track (or untrack), up to ${MAX_TRACKED_KEYWORDS_PER_PROJECT} — the same ` +
        "number one project may track in total. They are stored trimmed and lower-cased, so two " +
        'spellings differing only in case or spacing are ONE tracked keyword. Required for ' +
        '"track" and "untrack"; leave it out for "list", which is about the project rather than ' +
        "about a list you supply.",
    ),
  action: z
    .enum(TRACK_ACTIONS)
    .default("track")
    .describe(
      '"track" (default) starts watching these keywords; "untrack" stops; "list" reads back ' +
        "everything this project already tracks and writes nothing. Untracking archives the " +
        "keyword rather than deleting it — tracking it again brings back the same record, and no " +
        "stored measurement is ever removed by either.",
    ),
  location_name: z
    .string()
    .min(1)
    .default(DEFAULT_LOCATION_NAME)
    .describe(
      `Where the search is measured, as DataForSEO names it (default "${DEFAULT_LOCATION_NAME}"). ` +
        "It is part of what is tracked: the same keyword in two locations is two tracked keywords. " +
        "The vendor matches this name exactly and its spelling is sometimes not the usual English " +
        'one (it calls Turkey "Turkiye"); a name it is known not to use is refused here, with the ' +
        "right one named, rather than at the end of a paid SERP snapshot.",
    ),
  language_code: z
    .string()
    .min(2)
    .default(DEFAULT_LANGUAGE_CODE)
    .describe(
      `The search language (default "${DEFAULT_LANGUAGE_CODE}"). Part of what is tracked, like ` +
        "the location.",
    ),
  device: z
    .enum(SERP_DEVICES)
    .default(DEFAULT_DEVICE)
    .describe(
      `Which SERP to watch (default "${DEFAULT_DEVICE}"). Google returns different results and a ` +
        "different layout on each, so a desktop ranking says nothing about a mobile one — the " +
        "device is part of what is tracked.",
    ),
})
  /**
   * `keywords` IS STILL REQUIRED FOR THE TWO WRITES, and it is enforced at parse time rather
   * than in the handler so the refusal keeps arriving in the same envelope it always did — a
   * schema error, before any read, with the field named. `list` is the only action that is not
   * about a list the caller supplies, so it is the only one exempt.
   */
  .superRefine((value, ctx) => {
    if (value.action !== "list" && value.keywords === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["keywords"],
        message: `required for action "${value.action}" — only "list" takes no keywords`,
      });
    }
  });

type TrackKeywordsInput = z.infer<typeof inputSchema>;

const DESCRIPTION =
  "Choose which keywords a project's ranking is watched for, on one location, language and " +
  'device, and read back what it already tracks with action: "list". Registration only: it takes ' +
  "no measurement and contacts no search engine. Running it twice for the same keyword is safe, " +
  "and untracking archives rather than deletes. Costs 0 credits.";

/** The identity clause every answer repeats, so no reply is readable as a general statement. */
export function describeIdentity(input: {
  readonly location_name: string;
  readonly language_code: string;
  readonly device: TrackedDevice;
}): string {
  return `${input.location_name} · language ${input.language_code} · ${input.device} SERP`;
}

/** A keyword list, quoted, in the caller's own order. */
function quoteList(keywords: readonly string[]): string {
  return keywords.map((keyword) => `"${keyword}"`).join(", ");
}

/** One "n keyword(s)" clause, so no sentence has to guess at the plural. */
export function countClause(count: number, noun = "keyword"): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The cap refusal. It names the three numbers a caller needs in order to fix it themselves — what
 * is tracked now, what the cap is, and how many of THIS request were new — because a refusal that
 * only says "too many" leaves them guessing which keywords to drop.
 */
export function capRefusal(active: number, adding: number, projectDomain: string): string {
  return (
    `Nothing was changed: "${projectDomain}" is already tracking ${countClause(active)} and this ` +
    `request would add ${countClause(adding)}, over the limit of ` +
    `${MAX_TRACKED_KEYWORDS_PER_PROJECT} tracked keywords per project. The limit is about what a ` +
    "refresh of the whole set would cost and how much of it can be measured in one day — a " +
    "keyword tracked on two devices counts twice, because it is measured twice. Untrack what you " +
    "no longer watch (action: \"untrack\"), or split the rest across another project."
  );
}

/** Every requested keyword was blank once trimmed — there is nothing to register. */
export const NO_KEYWORDS_MESSAGE =
  "Nothing was changed: every keyword in the list was blank once trimmed, so there is nothing to " +
  "track. Pass the keywords you want watched, one per list entry.";

/** The sentence every answer ends on: what tracking is, and what it is not. */
export const NO_MEASUREMENT_NOTE =
  "Tracking records what to watch; it takes no measurement. No search engine was contacted, no " +
  "position was read, and nothing was charged. A position appears only once a SERP snapshot has " +
  "been taken for these keywords, and keyword_positions then reads what was stored.";

interface Classified {
  readonly created: readonly string[];
  readonly revived: readonly string[];
  readonly unchanged: readonly string[];
}

/**
 * Split the request against what storage already knows: never seen, seen but archived, and already
 * being watched. The three are reported separately because they are three different answers — and
 * because "already tracked" is the one a caller re-running a script needs to see as a SUCCESS.
 */
export function classify(
  requested: readonly string[],
  known: readonly { readonly keyword: string; readonly untrackedAt: string | null }[],
): Classified {
  const state = new Map(known.map((row) => [row.keyword, row.untrackedAt]));
  const created: string[] = [];
  const revived: string[] = [];
  const unchanged: string[] = [];
  for (const keyword of requested) {
    if (!state.has(keyword)) created.push(keyword);
    else if (state.get(keyword) === null) unchanged.push(keyword);
    else revived.push(keyword);
  }
  return { created, revived, unchanged };
}

export interface TrackKeywordsDeps {
  readonly loadProject?: LoadProjectFn;
  readonly loadTracked?: LoadTrackedFn;
  readonly listActive?: ListActiveTrackedFn;
  readonly countActive?: CountActiveTrackedFn;
  readonly track?: TrackKeywordsFn;
  readonly untrack?: UntrackKeywordsFn;
}

export function makeTrackKeywordsTool(deps: TrackKeywordsDeps = {}): RegisteredTool {
  const loadProject = deps.loadProject ?? loadOwnProject;
  const loadTracked = deps.loadTracked ?? loadTrackedKeywords;
  const listActive = deps.listActive ?? listActiveTrackedKeywords;
  const countActive = deps.countActive ?? countActiveTrackedKeywords;
  const track = deps.track ?? trackKeywords;
  const untrack = deps.untrack ?? untrackKeywords;
  return defineTool<TrackKeywordsInput>({
    name: "track_keywords",
    description: DESCRIPTION,
    inputSchema,
    // charge defaults to "surface": withCredits sees a cost of 0 and runs the handler directly,
    // so no reserve is opened and the ledger is never read or written (credits/guard.ts).
    handler: async (ctx, input) => {
      const project = await loadProject(ctx.userId, input.project_id);
      if (project === null) {
        // Missing and another tenant's leave through the SAME sentence, so this cannot be used to
        // learn which project ids exist (the get_job_status pattern).
        return errorResult(projectNotFoundMessage(input.project_id));
      }
      if (project.archivedAt !== null) {
        return errorResult(ARCHIVED_PROJECT_MESSAGE);
      }
      // THE READ, and it returns BEFORE the location check on purpose: listing is about what is
      // already stored, so refusing it over a location name in THIS call's arguments — a name the
      // caller never meant as a filter, since the read is not filtered by it — would refuse a
      // question about existing rows on the strength of a default.
      if (input.action === "list") {
        return textResult(renderTrackedList(project.domain, await listActive(ctx.userId, input.project_id)));
      }
      // Every path below writes or asks about a supplied list, and the schema has already
      // guaranteed there is one for both of those actions.
      const keywords = normalizeKeywordList(input.keywords ?? []);
      if (keywords.length === 0) {
        return errorResult(NO_KEYWORDS_MESSAGE);
      }
      // THE LOCATION IS CHECKED HERE, AT REGISTRATION, AND NOWHERE CHEAPER. A name DataForSEO does
      // not know is not refused when it is typed — it is refused at the END of the paid SERP call
      // this registration is the standing request for, and the caller is charged for the refusal
      // (measured 2026-08-25: "Türkiye" registered free, then cost 13 credits and $0.03 for zero
      // data). This is a pure string check: no vendor call, no network, nothing charged.
      const badLocation = checkLocationName(input.location_name);
      if (badLocation !== null) {
        return errorResult(`Nothing was tracked: ${locationRefusalMessage(badLocation)}`);
      }
      const identity = {
        projectId: input.project_id,
        locationName: input.location_name,
        languageCode: input.language_code,
        device: input.device,
      };
      const known = await loadTracked(ctx.userId, identity, keywords);

      if (input.action === "untrack") {
        const stamped = await untrack(ctx.userId, identity, keywords);
        const { created: neverTracked, revived: alreadyArchived } = classify(keywords, known);
        return textResult(
          renderUntracked(project.domain, input, stamped, neverTracked, alreadyArchived),
        );
      }

      const { created, revived, unchanged } = classify(keywords, known);
      // THE CAP, weighed BEFORE the write and only against what the request would ADD: a keyword
      // already being watched costs nothing new, so re-running the same call at the cap must
      // succeed rather than refuse. The count comes from the database, not from the rows in hand.
      const adding = created.length + revived.length;
      if (adding > 0) {
        const active = await countActive(ctx.userId, input.project_id);
        if (active + adding > MAX_TRACKED_KEYWORDS_PER_PROJECT) {
          return errorResult(capRefusal(active, adding, project.domain));
        }
      }
      const written = await track(ctx.userId, identity, keywords);
      if (written !== keywords.length) {
        // PostgREST reports a write that landed on nothing as a success; reporting "now tracked"
        // for rows that were not written is the defect untrack_project's header names.
        return errorResult(
          `Nothing can be promised about this request: ${countClause(keywords.length)} were sent ` +
            `and the write landed on ${countClause(written, "row")}. Run this again, and run ` +
            "track_keywords with the same list to see what is actually tracked.",
        );
      }
      return textResult(renderTracked(project.domain, input, { created, revived, unchanged }));
    },
  });
}

/** The "now tracking" answer: what changed, what did not, and what tracking is not. */
export function renderTracked(
  projectDomain: string,
  input: TrackKeywordsInput,
  { created, revived, unchanged }: Classified,
): string {
  const total = created.length + revived.length + unchanged.length;
  const lines = [
    `Tracking ${countClause(total)} for "${projectDomain}" — ${describeIdentity(input)}.`,
  ];
  if (created.length > 0) lines.push(`Newly tracked: ${quoteList(created)}.`);
  if (revived.length > 0) {
    lines.push(
      `Tracked again (the earlier record came back, so nothing about them was lost): ` +
        `${quoteList(revived)}.`,
    );
  }
  if (unchanged.length > 0) {
    lines.push(`Already tracked, unchanged: ${quoteList(unchanged)}.`);
  }
  return [lines.join("\n"), NO_MEASUREMENT_NOTE].join("\n\n");
}

/** The "stopped watching" answer. Untracking is reversible and takes nothing away. */
export function renderUntracked(
  projectDomain: string,
  input: TrackKeywordsInput,
  stamped: readonly string[],
  neverTracked: readonly string[],
  alreadyArchived: readonly string[],
): string {
  const lines: string[] = [];
  lines.push(
    stamped.length === 0
      ? `Nothing changed for "${projectDomain}" — ${describeIdentity(input)}.`
      : `Stopped tracking ${countClause(stamped.length)} for "${projectDomain}" — ` +
          `${describeIdentity(input)}: ${quoteList(stamped)}.`,
  );
  if (alreadyArchived.length > 0) {
    lines.push(`Already untracked, so their dates were left as they were: ${quoteList(alreadyArchived)}.`);
  }
  if (neverTracked.length > 0) {
    lines.push(
      `Not tracked for this project on this location, language and device, so there was nothing ` +
        `to stop: ${quoteList(neverTracked)}.`,
    );
  }
  lines.push(
    "Untracking archives the keyword — every position already measured for it is kept, and " +
      "tracking it again restores the same record. keyword_positions still reads what was stored.",
  );
  return lines.join("\n\n");
}

/** Byte order, so the same set of rows always prints in the same order (list_gsc_properties' rule). */
function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Nothing is tracked. A true answer, and not an error: the project is fine, it is just empty. */
function emptyListMessage(projectDomain: string): string {
  return (
    `"${projectDomain}" is not tracking any keywords right now. Run track_keywords with the ` +
    "keywords you want watched — it registers them and takes no measurement."
  );
}

/**
 * The READ answer: what this project watches, grouped by WHERE each keyword is watched.
 *
 * Grouped rather than one flat list because the identity is half of what a tracked keyword IS —
 * "seo tools" on two devices is two subscriptions, and a flat list would print the word twice
 * with nothing to say why. Both the groups and the keywords inside them are in byte order, so two
 * reads of an unchanged project are byte-identical.
 */
export function renderTrackedList(
  projectDomain: string,
  rows: readonly ActiveTrackedKeyword[],
): string {
  if (rows.length === 0) return emptyListMessage(projectDomain);
  const groups = new Map<string, readonly string[]>();
  for (const row of rows) {
    const identity = describeIdentity({
      location_name: row.locationName,
      language_code: row.languageCode,
      device: row.device,
    });
    groups.set(identity, [...(groups.get(identity) ?? []), row.keyword]);
  }
  const lines = [...groups.entries()]
    .sort(([a], [b]) => byteOrder(a, b))
    .map(([identity, keywords]) => `${identity}: ${quoteList([...keywords].sort(byteOrder))}`);
  return [
    `"${projectDomain}" is tracking ${countClause(rows.length)}, counting each location and ` +
      "device separately:",
    lines.join("\n"),
    NO_MEASUREMENT_NOTE,
  ].join("\n\n");
}

/** The production track_keywords tool (real DB). */
export const trackKeywordsTool = makeTrackKeywordsTool();
