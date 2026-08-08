import { z } from "zod";
import { forUser, getServiceClient } from "../db.ts";
import { requireWebBaseUrl } from "../env.ts";
import { defineTool, errorResult, textResult } from "./registry.ts";

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
    // indistinguishable here (the read is filtered to ctx.userId), so nothing leaks.
    const { data, error } = await forUser(getServiceClient(), ctx.userId)
      .selectOwn("projects", "id, domain")
      .eq("id", project_id)
      .maybeSingle();
    if (error) {
      throw new Error(`connect_gsc: project lookup failed: ${error.message}`);
    }
    if (!data) {
      return errorResult(
        `No project found with id ${project_id}. Create one with setup_project first.`,
      );
    }
    const { domain } = data as unknown as { domain: string };

    // Is it ALREADY connected? The answer sits in gsc_connections and used to go unread, so a
    // connected project got the same "go connect it" copy as an unconnected one (live product
    // test 2026-08-07). Same reader shape as pull_gsc_data's loadConnection: the literal table
    // is needed because forUser's selectOwn narrows filters to the columns common to ALL tenant
    // tables, which excludes project_id. Tenant scope is the explicit user_id filter (NEVER #4),
    // so another tenant's connection is indistinguishable from none.
    const { data: existing, error: connError } = await getServiceClient()
      .from("gsc_connections")
      .select("gsc_property")
      .eq("user_id", ctx.userId)
      .eq("project_id", project_id)
      .maybeSingle();
    if (connError) {
      throw new Error(`connect_gsc: connection lookup failed: ${connError.message}`);
    }

    const connectUrl = `${requireWebBaseUrl()}/api/gsc/connect?project_id=${project_id}`;

    if (existing) {
      const { gsc_property: property } = existing as unknown as { gsc_property: string };
      return textResult(
        `Google Search Console is already connected for ${domain} — property ${property}.\n\n` +
          "Run pull_gsc_data to fetch performance data, then find_quick_wins, " +
          "detect_cannibalization or analyze_content_decay.\n\n" +
          "If you need to connect a DIFFERENT property, or access was revoked on Google's side, " +
          `re-approve here:\n${connectUrl}`,
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
