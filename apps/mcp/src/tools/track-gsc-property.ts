import { z } from "zod";
import { canQuerySearchAnalytics, propertyToDomain, type GscSite } from "@pseo/core";
import { getServiceClient } from "../db.ts";
import {
  listAccountSitesFor,
  loadGscAccounts,
  type GscAccountSummary,
  type ListAccountSitesFn,
  type LoadGscAccountsFn,
} from "./list-gsc-properties.ts";
import { openTrackedProject, type ProjectResolution, type TrackedProject } from "./setup-project.ts";
import { defineTool, errorResult, textResult, type RegisteredTool } from "./registry.ts";

/**
 * track_gsc_property — turn a Search Console property into a tracked project, in one call.
 * 0 credits: it calls no paid API and never touches the ledger.
 *
 * `list_gsc_properties` shows the user what their Google accounts can reach; this is the write
 * half. It derives the domain from the property, opens the project (or brings it back from the
 * archive), and maps the property to it.
 *
 * TWO STRUCTURAL RULES, both of them load-bearing:
 *
 *   1. THE PROJECT IS OPENED THROUGH setup_project's ROUTE (openTrackedProject), never by a
 *      second insert here. Beyond avoiding a duplicate of the archive/race invariant, that route
 *      runs `normalizeDomain`. `propertyToDomain` (packages/core) only checks a domain's SHAPE
 *      and so accepts hosts the normalizer refuses — `foo.internal`, `x.local`, `a.test`. Writing
 *      the row here would walk straight past a gate setup_project enforces.
 *
 *   2. NOTHING ARRIVING IN THE INPUT IS EVIDENCE. The property is accepted only because a live
 *      `sites.list` on one of the caller's OWN connected accounts returned it — the same rule
 *      /app/connection's PropertyPicker states, and for the same reason: the picker greys out the
 *      rest, but a disabled <option> is a courtesy and this is the control.
 *
 * VALIDATION ORDER IS PART OF THE CONTRACT: listed → queryable → recognisable domain → project →
 * mapping. Steps 2 and 3 refuse BEFORE any project exists, because a project SeoGrep cannot
 * answer for is worse than no project — it reads as tracked and returns nothing (measured live
 * 2026-08-09 on bayder.com.tr and rkturizm.com).
 *
 * Every read and the write are tenant-scoped (NEVER #4); Google is reached through injected
 * ports, so tests run with zero network (NEVER #5).
 */

/** Open (or restore) the project for a domain. The default is setup_project's own route. */
export type OpenProjectFn = (userId: string, domain: string) => Promise<ProjectResolution>;

/** Store the (project → account, property) mapping. Tenant-scoped. */
export type MapPropertyFn = (args: {
  readonly userId: string;
  readonly projectId: string;
  readonly accountId: string;
  readonly property: string;
}) => Promise<void>;

export interface TrackGscPropertyDeps {
  readonly loadAccounts?: LoadGscAccountsFn;
  readonly listAccountSites?: ListAccountSitesFn;
  readonly openProject?: OpenProjectFn;
  readonly mapProperty?: MapPropertyFn;
}

/**
 * The mapping write. Same shape as /app/connection's saveProjectProperty: the tenant id rides
 * BOTH as a column and inside the conflict target, so the row can only ever land on this
 * tenant's (user_id, project_id) slot — the service-role client bypasses RLS, so that is the
 * whole boundary (NEVER #4). An upsert rather than an insert because re-pointing an already
 * connected project at a different property is a legitimate call, and migration 0010's unique
 * (user_id, project_id) is what makes it one row either way.
 */
const defaultMapProperty: MapPropertyFn = async ({ userId, projectId, accountId, property }) => {
  const { error } = await getServiceClient().from("gsc_connections").upsert(
    { user_id: userId, project_id: projectId, account_id: accountId, gsc_property: property },
    { onConflict: "user_id,project_id" },
  );
  if (error) {
    throw new Error(`gsc_connections upsert failed: ${error.message}`);
  }
};

/** One account that really does list the requested property, and at which permission level. */
interface PropertyMatch {
  readonly account: GscAccountSummary;
  readonly site: GscSite;
}

const NO_ACCOUNT =
  "No Google account is connected yet, so there is no Search Console property to track. Run " +
  "connect_gsc for one of your projects to connect one, then run list_gsc_properties.";

function notListedMessage(property: string): string {
  return (
    `"${property}" is not listed on any Google account you have connected, so it cannot be ` +
    "tracked. Run list_gsc_properties to see what your accounts can actually reach, and pass a " +
    "property exactly as it is printed there."
  );
}

/**
 * The account(s) we could not reach. Kept apart from the not-listed sentence on purpose: an
 * absence we did not observe is not an absence, and telling the user their property is missing
 * would send them to verify a property that was there all along.
 */
function unreadableMessage(emails: readonly string[]): string {
  return (
    `Nothing was changed: the Search Console properties of ${emails.join(", ")} could not be ` +
    "read just now, so whether that account lists this property is unknown. Try again shortly, " +
    "or reconnect the account on the Connection page in SeoGrep."
  );
}

function unqueryableMessage(property: string, level: string, email: string): string {
  return (
    `${email} lists "${property}" at permission level ${level}, and Google does not answer ` +
    "Search Console performance queries at that level — so it cannot be queried and no project " +
    "was opened for it. Verify the property in Search Console, or ask one of its owners to " +
    "grant this account access, then run this again."
  );
}

function unrecognisedMessage(property: string): string {
  return (
    `SeoGrep does not recognise "${property}" as a Search Console property for a website, so ` +
    "there is no site to track. Domain properties (sc-domain:example.com) and URL-prefix " +
    "properties (https://example.com/) are supported."
  );
}

/**
 * Exactly one account answered and it lists the property — but another account did not answer
 * at all, and it might list the property too. Had it answered, {@link ambiguousMessage} would
 * be refusing right now.
 *
 * So SeoGrep refuses here as well (controller ruling, 2026-08-13). Proceeding would let a
 * transient Google outage decide WHICH CREDENTIAL a project binds to — the one thing the
 * ambiguity guard exists to never guess — and it would contradict this tool's own rule that an
 * absence we did not observe is not an absence, at the point where the stakes are highest.
 *
 * Only reachable with two or more connected accounts: with one account, an unreadable account
 * produces no matches at all and the not-listed / unreadable branch answers first. So the cost
 * of failing closed is small, and it is paid only by the user who has the ambiguity to begin
 * with — who can settle it in one re-run with `account_id`.
 */
function undecidableMessage(
  property: string,
  foundOn: string,
  unreadable: readonly string[],
): string {
  return (
    `"${property}" is listed on ${foundOn}, but the Search Console properties of ` +
    `${unreadable.join(", ")} could not be read just now — so whether that account lists it too ` +
    "is unknown, and SeoGrep will not let an outage decide which account a project reads " +
    "through. Nothing was changed. Either run this again with account_id set to the account you " +
    "want it read through (list_gsc_properties prints the ids), or wait until the other account " +
    "can be read and run it again."
  );
}

/**
 * Two accounts list the same property — real on the operator's own account. SeoGrep does not
 * guess which one: the choice binds the project to a credential, and the wrong guess is only
 * discovered when the data stops arriving.
 */
function ambiguousMessage(property: string, matches: readonly PropertyMatch[]): string {
  const named = matches
    .map((match) => `${match.account.email} (account_id: ${match.account.id})`)
    .join("; ");
  return (
    `"${property}" is listed on more than one of your connected Google accounts — ${named}. ` +
    "Run this again with account_id set to the account SeoGrep should read it through."
  );
}

function trackedMessage(project: TrackedProject, property: string, email: string): string {
  const opened =
    project.outcome === "created"
      ? `Created project "${project.domain}"`
      : project.outcome === "restored"
        ? `Restored "${project.domain}" from your archive`
        : `Project "${project.domain}" was already tracked`;
  return (
    `${opened} (project_id: ${project.id}) and set it to read ${property} through ${email}.\n\n` +
    "Run pull_gsc_data for that project to fetch its Search Console performance data, then " +
    "find_quick_wins, detect_cannibalization or analyze_content_decay."
  );
}

/**
 * Build the tool. All I/O is injectable, so the fast-lane spec drives it with zero network and
 * zero database.
 */
export function makeTrackGscPropertyTool(deps: TrackGscPropertyDeps = {}): RegisteredTool {
  const loadAccounts = deps.loadAccounts ?? loadGscAccounts;
  const listAccountSites = deps.listAccountSites ?? listAccountSitesFor;
  const openProject = deps.openProject ?? openTrackedProject;
  const mapProperty = deps.mapProperty ?? defaultMapProperty;
  return defineTool({
    name: "track_gsc_property",
    description:
      "Start tracking a Search Console property: opens its project (or restores it from the " +
      "archive) and links the property to it. Costs 0 credits.",
    inputSchema: z.object({
      property: z
        .string()
        .min(1)
        .describe("The property exactly as list_gsc_properties reports it."),
      account_id: z
        .uuid()
        .optional()
        .describe("Which connected Google account, when more than one lists the property."),
    }),
    handler: async (ctx, { property, account_id: accountId }) => {
      const accounts = await loadAccounts(ctx.userId);
      if (accounts.length === 0) {
        return errorResult(NO_ACCOUNT);
      }
      // An account_id that is not the caller's narrows the candidates to none, and the answer
      // below is the SAME sentence a typo'd property gets — so this cannot be used to learn
      // which account ids exist (the get_job_status pattern).
      const candidates =
        accountId === undefined ? accounts : accounts.filter((a) => a.id === accountId);

      // STEP 1 — is it actually listed? Ask each candidate account live; nothing is cached,
      // because a property can be removed (or an account demoted) at any time.
      const matches: PropertyMatch[] = [];
      const unreadable: string[] = [];
      for (const account of candidates) {
        let sites: readonly GscSite[];
        try {
          sites = await listAccountSites(account.id, ctx.userId);
        } catch (error) {
          console.error(
            `track_gsc_property: sites.list failed for account ${account.id}:`,
            error,
          );
          unreadable.push(account.email);
          continue;
        }
        const site = sites.find((candidate) => candidate.siteUrl === property);
        if (site) {
          matches.push({ account, site });
        }
      }
      const [match, alsoListedElsewhere] = matches;
      if (match === undefined) {
        // A listing we never got back cannot be reported as "not listed" — say which it was.
        return errorResult(
          unreadable.length > 0 ? unreadableMessage(unreadable) : notListedMessage(property),
        );
      }
      if (alsoListedElsewhere !== undefined) {
        return errorResult(ambiguousMessage(property, matches));
      }
      // The ambiguity guard above can only weigh the accounts that ANSWERED. If one did not,
      // it might list this property too — see undecidableMessage for why that is a refusal
      // rather than a proceed. The `accountId === undefined` clause states the rule fully even
      // though the candidate filter above already implies it: when the caller names an account,
      // no other account is ever asked, so nothing can be left unread behind their back.
      if (unreadable.length > 0 && accountId === undefined) {
        return errorResult(undecidableMessage(property, match.account.email, unreadable));
      }
      const { account, site } = match;

      // STEP 2 — queryable? Refuse BEFORE opening a project: a project SeoGrep cannot answer
      // for looks tracked and returns nothing.
      if (!canQuerySearchAnalytics(site.permissionLevel)) {
        return errorResult(
          unqueryableMessage(property, site.permissionLevel, account.email),
        );
      }

      // STEP 3 — does the property name a website at all? (android-app:// properties do not.)
      const domain = propertyToDomain(property);
      if (domain === null) {
        return errorResult(unrecognisedMessage(property));
      }

      // STEP 4 — setup_project's route, refusals included (see rule 1 in the header).
      const resolved = await openProject(ctx.userId, domain);
      if (!resolved.ok) {
        return errorResult(resolved.error);
      }

      // STEP 5 — the mapping.
      await mapProperty({
        userId: ctx.userId,
        projectId: resolved.project.id,
        accountId: account.id,
        property,
      });
      return textResult(trackedMessage(resolved.project, property, account.email));
    },
  });
}

/** The production track_gsc_property tool (real DB + Google client). */
export const trackGscPropertyTool = makeTrackGscPropertyTool();
