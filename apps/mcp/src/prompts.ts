import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  type GetPromptResult,
  type ListPromptsResult,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP prompts — where the skill orchestration moved (spec §2.1). Three English, step-by-step
 * templates that string the tools into the common workflows so a non-expert can run them by name:
 *
 *   new-site-audit   — setup_project -> crawl_site -> audit trio -> generate_report (the GSC-less
 *                      first-audit flow; connecting Search Console stays optional).
 *   monthly-routine  — pull_gsc_data -> discovery trio -> generate_report.
 *   quick-wins-sprint — pull_gsc_data -> find_quick_wins -> prioritization.
 *
 * These are STATIC (no tenant/DB), so the surface is pure and stateless — the same shape as the
 * gateway's stateless tools path. prompts/list advertises the three; prompts/get renders one with
 * its argument interpolated. Registered on the low-level Server via registerPrompts (server.ts).
 */

/** A prompt argument as advertised in prompts/list. */
export interface PromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

/** A prompt definition: its metadata plus a pure renderer that fills the message from arguments. */
export interface PromptDefinition {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly PromptArgument[];
  /** Render the prompt body from the supplied arguments (missing values become placeholders). */
  readonly render: (args: Record<string, string>) => string;
}

/** Return a trimmed argument value, or a readable `<placeholder>` so a template never has a gap. */
function argOr(args: Record<string, string>, key: string, placeholder: string): string {
  const value = args[key];
  return value && value.trim() ? value.trim() : placeholder;
}

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: "new-site-audit",
    description:
      "Run a first-time SEO audit of a website: register it, crawl it, run the on-page, technical, " +
      "and schema audits, then produce a shareable report. Works without Google Search Console.",
    arguments: [
      { name: "domain", description: "The website domain to audit, e.g. example.com.", required: true },
    ],
    render: (args) => {
      const domain = argOr(args, "domain", "<your-domain.com>");
      return (
        `You are helping me run a first-time SEO audit of ${domain} with SeoGrep. Walk me through it ` +
        "step by step, calling one tool at a time and explaining each result in plain language:\n\n" +
        `1. setup_project — register ${domain} as a project. This returns a project_id; reuse it ` +
        "below (if it already exists, list_projects gives you the id).\n" +
        "2. crawl_site — crawl the site. It runs asynchronously and returns a job_id; poll " +
        "get_job_status until it succeeds. This step works without Google Search Console.\n" +
        "3. audit_onpage, then audit_tech, then audit_schema — run all three over the crawl to find " +
        "on-page, technical, and structured-data issues.\n" +
        "4. connect_gsc (optional) — connect Google Search Console for deeper, query-level analysis. " +
        "This is optional and never required for the audit above.\n" +
        "5. generate_report — roll everything up into a shareable HTML report with a public link.\n\n" +
        "Start with step 1 and wait for each tool to finish before moving on."
      );
    },
  },
  {
    name: "monthly-routine",
    description:
      "Run the monthly SeoGrep routine for a project: refresh Search Console data, run the three " +
      "discovery tools, and produce a report summarizing what changed.",
    arguments: [
      {
        name: "project_id",
        description: "The project to run the monthly routine for (from list_projects).",
        required: true,
      },
    ],
    render: (args) => {
      const projectId = argOr(args, "project_id", "<your-project-id>");
      return (
        `Run my monthly SeoGrep routine for project ${projectId}. Go step by step, one tool at a ` +
        "time, and summarize what changed since last month:\n\n" +
        "1. pull_gsc_data — pull the latest 90 days of Google Search Console data (this needs " +
        "connect_gsc to have been done once for the project).\n" +
        "2. find_quick_wins, then detect_cannibalization, then analyze_content_decay — run all three " +
        "discovery tools over the fresh data.\n" +
        "3. generate_report — roll the findings up into a shareable report.\n\n" +
        "If the project has no Search Console connection yet, tell me to run connect_gsc first."
      );
    },
  },
  {
    name: "quick-wins-sprint",
    description:
      "Run a focused quick-wins sprint for a project: refresh Search Console data, list the pages " +
      "ranking just below page one, and prioritize the highest-impact, lowest-effort fixes.",
    arguments: [
      {
        name: "project_id",
        description: "The project to run the quick-wins sprint for (from list_projects).",
        required: true,
      },
    ],
    render: (args) => {
      const projectId = argOr(args, "project_id", "<your-project-id>");
      return (
        `Help me run a focused quick-wins sprint for project ${projectId} using SeoGrep:\n\n` +
        "1. pull_gsc_data — refresh the latest Google Search Console data.\n" +
        "2. find_quick_wins — list the pages ranking just below the first page (roughly positions " +
        "8–20) that have enough impressions to be worth improving.\n" +
        "3. For each quick win, prioritize by impressions and how close it is to page one, and " +
        "suggest one concrete on-page improvement. If a crawl exists, use audit_onpage on the " +
        "affected pages for specifics.\n\n" +
        "Focus on the highest-impact, lowest-effort wins first."
      );
    },
  },
];

/** The prompts/list response — the advertised metadata for every prompt. */
export function listPrompts(): ListPromptsResult {
  return {
    prompts: PROMPTS.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments.map((argument) => ({
        name: argument.name,
        description: argument.description,
        required: argument.required,
      })),
    })),
  };
}

/**
 * The prompts/get response for `name`, rendered with `args`. An unknown name throws (the SDK turns
 * it into a JSON-RPC error). The single user message carries the step-by-step guide as text.
 */
export function getPrompt(name: string, args: Record<string, string> = {}): GetPromptResult {
  const prompt = PROMPTS.find((candidate) => candidate.name === name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  return {
    description: prompt.description,
    messages: [{ role: "user", content: { type: "text", text: prompt.render(args) } }],
  };
}

/**
 * Wire the MCP prompts/list + prompts/get handlers on a stateless Server. The prompts are static,
 * so no tenant context is needed — mirrors registerAll's shape for the tools surface.
 */
export function registerPrompts(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, () => listPrompts());
  server.setRequestHandler(GetPromptRequestSchema, (request) =>
    getPrompt(request.params.name, request.params.arguments ?? {}),
  );
}
