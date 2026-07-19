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

    const connectUrl = `${requireWebBaseUrl()}/api/gsc/connect?project_id=${project_id}`;
    return textResult(
      `To connect Google Search Console for ${domain}, open this link and approve access:\n` +
        `${connectUrl}\n\n` +
        "This is optional — your crawl and audit tools already work without it. SeoGrep " +
        "requests READ-ONLY Search Console access and never write access to your property.",
    );
  },
});
