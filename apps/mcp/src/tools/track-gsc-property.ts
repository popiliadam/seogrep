import { z } from "zod";
import {
  canQuerySearchAnalytics,
  cosmeticPropertyMatch,
  normalizeDomain,
  propertyToDomain,
  stripWwwLabel,
  type GscSite,
} from "@pseo/core";
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
 * A BARE HOST IS RESOLVED, NEVER GUESSED (step 1b, 2026-08-25). `track_gsc_property("dentnotion.com")`
 * used to be refused as "not listed" while `https://dentnotion.com/` was the single unambiguous
 * candidate in the caller's own listing — a resolvable match left unresolved. It now resolves
 * when exactly ONE listed property names that host (`www.` ignored on both sides) and OFFERS THE
 * CHOICE when several do. Rule 2 is untouched by this: the resolution reads only what a live
 * `sites.list` returned, so nothing in the input has become evidence.
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

/**
 * Byte-order string comparison, used everywhere this tool has to put accounts or properties in
 * an order. Explicit rather than a bare `.sort()` so the ordering is a stated decision, and NOT
 * `localeCompare`, whose answer depends on the runtime's locale — which would make a refusal
 * message differ between a developer's machine and the server.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** What one candidate account answered: its sites, or null when the read failed. */
interface AccountAnswer {
  readonly account: GscAccountSummary;
  readonly sites: readonly GscSite[] | null;
}

/**
 * Ask every candidate account for its property list AT ONCE, and never let one account's failure
 * become another's answer.
 *
 * PARALLEL because these are independent reads of different credentials, and the serial version
 * made a user with three accounts wait for three round trips to Google to be told something
 * about the first one. Each read is caught INSIDE its own task, so this settles rather than
 * rejects: a bare `Promise.all` over uncaught rejections would abandon the successful reads the
 * moment any one account failed, turning one dead credential into "nothing could be read" — the
 * exact confusion between "absent" and "unobserved" this tool exists to prevent.
 *
 * ORDER IS NOT INHERITED FROM THE DATABASE. `Promise.all` preserves input order, but the input is
 * whatever order `loadGscAccounts` happened to return, which no query here pins. Every list this
 * function produces is therefore sorted by email, so the ambiguous / undecidable / unreadable
 * refusals name the same accounts in the same order on every run.
 */
async function askEachAccount(
  candidates: readonly GscAccountSummary[],
  listAccountSites: ListAccountSitesFn,
  userId: string,
): Promise<readonly AccountAnswer[]> {
  const answers = await Promise.all(
    candidates.map(async (account): Promise<AccountAnswer> => {
      try {
        return { account, sites: await listAccountSites(account.id, userId) };
      } catch (error) {
        console.error(`track_gsc_property: sites.list failed for account ${account.id}:`, error);
        return { account, sites: null };
      }
    }),
  );
  return [...answers].sort((a, b) => compareStrings(a.account.email, b.account.email));
}

/**
 * Nothing connected. The route is spelled out from the caller's ACTUAL starting point, which may
 * be zero projects: `connect_gsc` takes a `project_id` and refuses without one, so pointing a
 * brand-new account straight at it names a step they cannot take and does not name the one they
 * can. `setup_project` comes first, and says so here rather than being left to be discovered.
 */
const NO_ACCOUNT =
  "No Google account is connected yet, so there is no Search Console property to track. If you " +
  "have no projects yet, run setup_project for your domain first — connect_gsc needs a project " +
  "to start from. Then run connect_gsc for that project, and list_gsc_properties to see what it " +
  "can reach.";

/**
 * The near-miss suggestion. The RULE — which two property strings differ only cosmetically —
 * lives in @pseo/core (`cosmeticPropertyMatch`), because /app/connection refuses the same
 * request and may not disagree about it; see the note there for why the rule is deliberately
 * dumb and why `sc-domain:` never suggests `https://`. This function is only the sentence.
 */
function notListedMessage(property: string, listed: readonly string[] = []): string {
  const suggestion = cosmeticPropertyMatch(property, listed);
  return (
    `"${property}" is not listed on any Google account you have connected, so it cannot be ` +
    "tracked. Run list_gsc_properties to see what your accounts can actually reach, and pass a " +
    "property exactly as it is printed there." +
    (suggestion === null ? "" : ` Did you mean "${suggestion}"?`)
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

/**
 * The input read as a BARE HOST — the form a customer speaks ("dentnotion.com") rather than the
 * form Search Console prints ("https://dentnotion.com/"). Null when the string is any recognised
 * PROPERTY form, so this never competes with the exact match or with the near-miss suggestion.
 *
 * The `[:/]` test is what draws that line, and it draws it wide on purpose: `sc-domain:x`,
 * `https://x/` and a bare `x/` all carry one of those two characters, and every one of them is a
 * property string the caller either got right or got cosmetically wrong. Only a string with
 * neither is a host somebody typed from memory.
 *
 * Measured live 2026-08-25: `track_gsc_property("dentnotion.com")` was refused as "not listed on
 * any Google account you have connected" while `https://dentnotion.com/` sat in
 * `list_gsc_properties` as the single unambiguous match. A resolvable match was not being
 * resolved.
 */
function bareHostInput(property: string): string | null {
  const raw = property.trim();
  if (/[:/]/.test(raw)) return null;
  const normalized = normalizeDomain(raw);
  return normalized.ok ? normalized.domain : null;
}

/**
 * Whether a listed property names `host` — `www.` ignored on both sides, since one site's
 * property may be `sc-domain:example.com` while its project is `www.example.com`.
 *
 * `propertyToDomain` answers null for a property that names no website (android-app://), and a
 * null never matches: a host cannot resolve to something that is not a site.
 */
function propertyNamesHost(siteUrl: string, host: string): boolean {
  const domain = propertyToDomain(siteUrl);
  return domain !== null && stripWwwLabel(domain) === host;
}

/**
 * One spoken host, several properties. `sc-domain:example.com` and `https://example.com/` are
 * two DIFFERENT Search Console properties for one site — different data, different permissions —
 * so the tool offers the choice instead of taking it.
 *
 * This is the same ruling the two-accounts branch makes and for the same reason: the pick binds
 * a project to a source, and a wrong binding is only discovered when the data stops making
 * sense. Silently choosing one of several is the one outcome that must not happen here.
 */
function hostChoiceMessage(host: string, properties: readonly string[]): string {
  const named = properties.map((property) => `"${property}"`).join("; ");
  return (
    `"${host}" matches more than one Search Console property on your connected accounts — ` +
    `${named}. Those are separate properties with separate data, so SeoGrep will not choose one ` +
    "for you. Run this again with the one you want, spelled exactly as it is printed here."
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

/**
 * WHAT A DOMAIN PROPERTY CANNOT DO, said once, on the surface that knows the kind (R-6.7).
 *
 * Google's disavow links tool does not support Domain properties. This tool already holds
 * `sc-domain:example.com` and `https://example.com/` apart as two different properties — it
 * refuses to choose between them for the user, for exactly that reason — so it is the one place
 * that knows which kind was just bound, and it said nothing: a tenant connected only to
 * `sc-domain:` could find this out only by running `disavow_candidates` and hitting it there.
 *
 * ONLY on the Domain branch. On a URL-prefix property the limitation does not apply, and a
 * sentence about a tool the caller has not reached would be noise on every successful call.
 */
const DISAVOW_DOMAIN_NOTE =
  "Note for later: Google's disavow links tool does not support Domain properties, so a disavow " +
  "file for this site has to be submitted through a URL-prefix property instead.";

/** Whether a property string names a Search Console DOMAIN property rather than a URL prefix. */
function isDomainProperty(property: string): boolean {
  return property.startsWith("sc-domain:");
}

/**
 * What happened, in one sentence per outcome.
 *
 * THE THIRD BRANCH USED TO BE UNGRAMMATICAL and it is customer-visible: "Project "x" was already
 * tracked … and set it to read …" changes subject halfway through — the first clause is about
 * the project, the second needs SeoGrep as its subject. Created and restored share a tail
 * because their first clause really does take one ("Created project x … and set it to read y");
 * the already-tracked clause does not, so it gets its own.
 */
function trackedMessage(project: TrackedProject, property: string, email: string): string {
  const source = `${property} through ${email}`;
  const opened =
    project.outcome === "created"
      ? `Created project "${project.domain}" (project_id: ${project.id}) and set it to read ` +
        `${source}.`
      : project.outcome === "restored"
        ? `Restored "${project.domain}" from your archive (project_id: ${project.id}) and set ` +
          `it to read ${source}.`
        : `Project "${project.domain}" was already tracked (project_id: ${project.id}); it now ` +
          `reads ${source}.`;
  const next =
    "Run pull_gsc_data for that project to fetch its Search Console performance data, then " +
    "find_quick_wins, detect_cannibalization or analyze_content_decay.";
  const parts = isDomainProperty(property)
    ? [opened, next, DISAVOW_DOMAIN_NOTE]
    : [opened, next];
  return parts.join("\n\n");
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
        .describe(
          "The property exactly as list_gsc_properties reports it. A bare domain " +
            '("example.com") also works when it matches exactly one of them.',
        ),
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

      // STEP 1 — is it actually listed? Ask every candidate account live and in parallel;
      // nothing is cached, because a property can be removed (or an account demoted) at any
      // time. The answers come back sorted by email, so every refusal below is deterministic.
      const answers = await askEachAccount(candidates, listAccountSites, ctx.userId);
      const matches: PropertyMatch[] = [];
      const unreadable: string[] = [];
      // Every property any account DID list, for the near-miss suggestion below. Read only from
      // accounts that answered — a property we never saw cannot be offered as a correction.
      const listedProperties: string[] = [];
      // The input read as a bare host, and every listed property that names it. Collected in the
      // same pass and consulted ONLY if the exact match came up empty, so a caller who spelled a
      // property correctly is never re-interpreted.
      const spokenHost = bareHostInput(property);
      const hostMatches: PropertyMatch[] = [];
      for (const { account, sites } of answers) {
        if (sites === null) {
          unreadable.push(account.email);
          continue;
        }
        for (const site of sites) {
          listedProperties.push(site.siteUrl);
        }
        const site = sites.find((candidate) => candidate.siteUrl === property);
        if (site) {
          matches.push({ account, site });
        }
        if (spokenHost !== null) {
          // filter, not find: one account can hold BOTH `sc-domain:x` and `https://x/`, and
          // taking the first would hide exactly the ambiguity that must be offered as a choice.
          for (const named of sites.filter((c) => propertyNamesHost(c.siteUrl, spokenHost))) {
            hostMatches.push({ account, site: named });
          }
        }
      }
      // STEP 1b — the customer spoke a host rather than a property string. Resolve it when the
      // answer is unambiguous; offer the choice when it is not. A property that WAS matched
      // exactly never reaches this, and neither does an unreadable-account run below.
      if (matches.length === 0 && hostMatches.length > 0) {
        const distinct = [...new Set(hostMatches.map((hit) => hit.site.siteUrl))].sort(
          compareStrings,
        );
        const [only] = distinct;
        if (distinct.length > 1 || only === undefined) {
          return errorResult(hostChoiceMessage(property, distinct));
        }
        matches.push(...hostMatches);
      }
      const [match, alsoListedElsewhere] = matches;
      if (match === undefined) {
        // A listing we never got back cannot be reported as "not listed" — say which it was.
        return errorResult(
          unreadable.length > 0
            ? unreadableMessage(unreadable)
            : notListedMessage(property, listedProperties),
        );
      }
      // THE PROPERTY THIS CALL IS ABOUT, from here down. It is Google's own spelling of the
      // matched listing rather than the caller's input, because a bare host resolved above is
      // not a property string — binding, mapping and every sentence below must name the
      // property Search Console actually holds. For an exact match the two are identical.
      const subject = match.site.siteUrl;
      if (alsoListedElsewhere !== undefined) {
        return errorResult(ambiguousMessage(subject, matches));
      }
      // The ambiguity guard above can only weigh the accounts that ANSWERED. If one did not,
      // it might list this property too — see undecidableMessage for why that is a refusal
      // rather than a proceed. The `accountId === undefined` clause states the rule fully even
      // though the candidate filter above already implies it: when the caller names an account,
      // no other account is ever asked, so nothing can be left unread behind their back.
      if (unreadable.length > 0 && accountId === undefined) {
        return errorResult(undecidableMessage(subject, match.account.email, unreadable));
      }
      const { account, site } = match;

      // STEP 2 — queryable? Refuse BEFORE opening a project: a project SeoGrep cannot answer
      // for looks tracked and returns nothing.
      if (!canQuerySearchAnalytics(site.permissionLevel)) {
        return errorResult(
          unqueryableMessage(subject, site.permissionLevel, account.email),
        );
      }

      // STEP 3 — does the property name a website at all? (android-app:// properties do not.)
      const domain = propertyToDomain(subject);
      if (domain === null) {
        return errorResult(unrecognisedMessage(subject));
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
        property: subject,
      });
      return textResult(trackedMessage(resolved.project, subject, account.email));
    },
  });
}

/** The production track_gsc_property tool (real DB + Google client). */
export const trackGscPropertyTool = makeTrackGscPropertyTool();
