import { z } from "zod";
import { forUser, getServiceClient } from "../db.ts";
import { defineTool, textResult } from "./registry.ts";

/**
 * list_projects — the tenant's tracked domains. 0 credits. Reads through forUser so
 * the query is tenant-scoped by construction (constitution NEVER #4); an empty result
 * returns actionable guidance rather than a bare empty list. Ordering is applied in
 * memory (oldest first) so the output is deterministic regardless of scan order.
 */
export const listProjectsTool = defineTool({
  name: "list_projects",
  description: "List the website domains you are tracking (oldest first).",
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const { data, error } = await forUser(getServiceClient(), ctx.userId).selectOwn(
      "projects",
      "id, domain, created_at",
    );
    if (error) {
      throw new Error(`projects list failed: ${error.message}`);
    }
    // forUser.selectOwn takes a runtime column string, so supabase-js cannot infer the
    // row shape (it falls back to GenericStringError[]); assert the known projection.
    const rows = (data ?? []) as unknown as { id: string; domain: string; created_at: string }[];
    if (rows.length === 0) {
      return textResult(
        'No projects yet. Add one with the setup_project tool, e.g. setup_project { "domain": "example.com" }.',
      );
    }
    const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const lines = ordered.map((project) => `- ${project.domain} (project_id: ${project.id})`);
    return textResult(`You are tracking ${ordered.length} project(s):\n${lines.join("\n")}`);
  },
});
