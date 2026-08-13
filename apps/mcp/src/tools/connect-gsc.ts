import { z } from "zod";
import { getServiceClient } from "../db.ts";
import { optionalWebBaseUrl, requireWebBaseUrl } from "../env.ts";
import { ARCHIVED_PROJECT_MESSAGE, loadOwnProject } from "./project-target.ts";
import { defineTool, errorResult, textResult } from "./registry.ts";

/**
 * Copy for a project whose gsc_connections row carries a LIVE mapping — a non-null
 * `account_id`. `gsc_property` is nullable and really is null in production: the OAuth
 * round-trip can complete while sites.list matches nothing (web callback step 7 leaves the
 * property unmatched rather than dropping the token). That branch used to interpolate the raw
 * value, so the live answer for www.noraninsaat.com on 2026-08-09 was the sentence
 * "property null" — the user was told everything was fine while every Search Console tool on
 * the project was dead.
 *
 * BOTH branches point PROPERTY changes at the picker, not at a fresh consent. Migration 0021
 * moved the property choice out of the OAuth callback and onto /app/connection: the callback
 * now stores a Google ACCOUNT and writes no connection row at all, so "re-approve here to
 * connect a different property" describes a round trip that cannot change a property. The
 * connect link stays for the one thing it still does — re-granting an account whose access
 * was withdrawn at Google.
 *
 * Exported so both branches are pinned without a database (the fast-lane spec).
 */
export function renderAlreadyConnected(args: {
  domain: string;
  property: string | null;
  connectUrl: string;
  pickerUrl: string;
}): string {
  const { domain, property, connectUrl, pickerUrl } = args;
  if (property === null) {
    return (
      `Google Search Console is connected for ${domain}, but none of the verified properties ` +
      "in that Google account matched it — nothing was stored, so pull_gsc_data and the tools " +
      "that read its data cannot run yet.\n\n" +
      `To fix it, verify a property for ${domain} in Search Console: either a URL-prefix ` +
      `property (https://${domain}/) or a domain property for that domain. A domain property ` +
      "named for a PARENT domain is not used — SeoGrep drops a leading www. label and no " +
      "other subdomain label, because a subdomain can belong to someone else.\n\n" +
      `Once the property is verified, choose it for ${domain} on the Connection page:\n` +
      `${pickerUrl}\n\n` +
      `If that Google account has lost access altogether, re-approve it here:\n${connectUrl}`
    );
  }
  return (
    `Google Search Console is already connected for ${domain} — property ${property}.\n\n` +
    "Run pull_gsc_data to fetch performance data, then find_quick_wins, " +
    "detect_cannibalization or analyze_content_decay.\n\n" +
    "To read a DIFFERENT property, change it on the Connection page — approving again here " +
    `does not change which property this project reads:\n${pickerUrl}\n\n` +
    `If access was revoked on Google's side, re-approve here:\n${connectUrl}`
  );
}

/**
 * The web app's OAuth entry point for one project — the ONE link that starts (or restarts) a
 * Search Console connection. Three surfaces hand it out now (connect_gsc, the reauth refusal, the
 * staleness warning), so the route's shape lives here once rather than in three string literals.
 *
 * Fail-closed on WEB_BASE_URL — for THIS reader, whose caller is connect_gsc, where the link is
 * the entire answer: a missing value is a deploy misconfiguration (the 2026-07-28 audit closure
 * records that it must be set in every environment) and a "undefined/api/gsc/connect" link is
 * worse than a loud error. The other two callers take the soft reader below; see why there.
 */
export function gscConnectUrl(projectId: string): string {
  return connectPath(requireWebBaseUrl(), projectId);
}

/**
 * The same link, read SOFTLY: null when WEB_BASE_URL is unset instead of throwing.
 *
 * For the two surfaces that merely REFERENCE the link inside a larger, already-useful sentence —
 * the typed reauth refusal and the discovery tools' staleness warning. For them, a throw is not a
 * loud failure but a silent downgrade: it turns "your connection expired, reconnect it" back into
 * "failed unexpectedly — quote reference …", which is the defect those sentences exist to remove.
 * connect_gsc keeps the fail-closed reader above, because there the link IS the whole answer.
 *
 * Exactly the split env.ts already draws between requireWebBaseUrl and optionalWebBaseUrl, and
 * for the reason written there: fail-closed is for what would otherwise degrade SILENTLY.
 */
export function optionalGscConnectUrl(projectId: string): string | null {
  const base = optionalWebBaseUrl();
  return base === null ? null : connectPath(base, projectId);
}

/** The route's shape, in ONE place — both readers above compose it. */
function connectPath(baseUrl: string, projectId: string): string {
  return `${baseUrl}/api/gsc/connect?project_id=${projectId}`;
}

/**
 * The Connection page — where a project's Search Console PROPERTY is chosen since migration
 * 0021. Not an invented endpoint (NEVER #9): it is apps/web/app/app/connection/page.tsx, the
 * nav label in apps/web/app/app/layout.tsx, and the page reauth-error.ts already names by hand
 * when it has no base URL to build a link from.
 *
 * Fail-closed on WEB_BASE_URL for the same reason gscConnectUrl is: this reader's only caller
 * is connect_gsc, where both links ARE the answer, and it already throws one line earlier.
 */
export function gscPropertyPickerUrl(): string {
  return `${requireWebBaseUrl()}/app/connection`;
}

/**
 * connect_gsc — hand the user a Google sign-in link that connects Search Console to one
 * of their projects. 0 credits. This tool is the "link-out" surface (design D15): OAuth
 * is deliberately the SECOND step, never the first barrier — crawl + audit already work
 * without it, so the copy frames the connection as optional.
 *
 * The MCP gateway never touches Google or the token here: it validates that the project
 * belongs to the caller (tenant-scoped read, constitution NEVER #4), then returns a link
 * to the web app's `/api/gsc/connect`, which runs the actual OAuth redirect + callback
 * (browser session, server-side client_secret, at-rest token seal). The project id is
 * carried in the link; the web route re-verifies ownership against the signed-in user.
 */
export const connectGscTool = defineTool({
  name: "connect_gsc",
  description:
    "Connect Google Search Console to a project. Returns a secure Google sign-in link that " +
    "grants SeoGrep read-only access. Optional — your crawl and audit tools work without it. " +
    "Costs 0 credits.",
  inputSchema: z.object({
    project_id: z.uuid().describe("The project to connect (from setup_project / list_projects)."),
  }),
  handler: async (ctx, { project_id }) => {
    // Tenant-scoped ownership gate: a missing project and another tenant's project are
    // indistinguishable here (the read is filtered to ctx.userId), so nothing leaks. The read is
    // the SHARED loadOwnProject rather than a second one of its own — a per-tool project read is
    // a per-tool place for the archive check below to be forgotten.
    const project = await loadOwnProject(ctx.userId, project_id);
    if (!project) {
      return errorResult(
        `No project found with id ${project_id}. Create one with setup_project first.`,
      );
    }
    // AFTER the ownership gate, never before: an archived project of ANOTHER tenant must stay
    // indistinguishable from one that does not exist (see project-target.ts). connect_gsc costs
    // 0 credits, so the refusal has no ledger to avoid — it avoids handing out a connect link
    // for a project that is not being tracked.
    if (project.archivedAt !== null) {
      return errorResult(ARCHIVED_PROJECT_MESSAGE);
    }
    const { domain } = project;

    // Is it ALREADY connected? The answer sits in gsc_connections and used to go unread, so a
    // connected project got the same "go connect it" copy as an unconnected one (live product
    // test 2026-08-07). Same reader shape as pull_gsc_data's loadConnection: the literal table
    // is needed because forUser's selectOwn narrows filters to the columns common to ALL tenant
    // tables, which excludes project_id. Tenant scope is the explicit user_id filter (NEVER #4),
    // so another tenant's connection is indistinguishable from none.
    //
    // CONNECTED IS `account_id !== null`, NOT the existence of the row (migration 0021). The
    // row is a MAPPING now: unmapProject keeps it and nulls both columns, and disconnecting a
    // Google account nulls `account_id` on every project of that account through `on delete
    // set null`. Reading row existence answered "already connected — property https://…" for
    // a project with no credential behind it — the byte-identical sentence measured as defect
    // #52 — while pull_gsc_data refused the very same state with "run connect_gsc first".
    const { data: existing, error: connError } = await getServiceClient()
      .from("gsc_connections")
      .select("account_id, gsc_property")
      .eq("user_id", ctx.userId)
      .eq("project_id", project_id)
      .maybeSingle();
    if (connError) {
      throw new Error(`connect_gsc: connection lookup failed: ${connError.message}`);
    }

    const connectUrl = gscConnectUrl(project_id);
    const mapping = existing as unknown as {
      account_id: string | null;
      gsc_property: string | null;
    } | null;

    if (mapping && mapping.account_id !== null) {
      // `gsc_property` is nullable in the schema (migration 0009) and the null is meaningful,
      // not a placeholder — see renderAlreadyConnected.
      return textResult(
        renderAlreadyConnected({
          domain,
          property: mapping.gsc_property ?? null,
          connectUrl,
          pickerUrl: gscPropertyPickerUrl(),
        }),
      );
    }

    return textResult(
      `To connect Google Search Console for ${domain}, open this link and approve access:\n` +
        `${connectUrl}\n\n` +
        "This is optional — your crawl and audit tools already work without it. SeoGrep " +
        "requests READ-ONLY Search Console access and never write access to your property.",
    );
  },
});
