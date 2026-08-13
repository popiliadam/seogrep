import { z } from "zod";
import { nonPublicHostnameReason } from "../crawler/ssrf.ts";
import { getServiceClient } from "../db.ts";
import { defineTool, errorResult, textResult } from "./registry.ts";

/**
 * setup_project — register (or return) a tracked domain for the tenant. 0 credits.
 * Idempotent by (user_id, domain): a second call for the same site returns the existing
 * project rather than creating a duplicate. A tenant-scoped read-first serves the common
 * repeat call, and the residual race of two truly-simultaneous first calls is closed at the
 * DB level — the (user_id, domain) unique constraint (migration 0010) plus an ON CONFLICT
 * DO NOTHING upsert: the loser's insert is a no-op and it reads back the winner's row, so two
 * concurrent first calls still produce ONE row with consistent created: true/false flags.
 *
 * Idempotency covers the ARCHIVE too: a domain the tenant had archived comes back on its
 * original id (archived_at cleared) instead of being registered a second time — see
 * returnExisting.
 */

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type NormalizedDomain = { readonly ok: true; readonly domain: string } | {
  readonly ok: false;
  readonly error: string;
};

/**
 * Canonicalize a domain input. Accepts a bare host or a full URL; extracts the host,
 * lowercases it, drops any trailing dot (FQDN) — the scheme/path/port/query fall away
 * with the URL parse. Returns a descriptive English error for anything that is not a
 * valid public domain (no host, single label, illegal characters, or an internal /
 * reserved name such as foo.internal / x.local).
 */
export function normalizeDomain(raw: string): NormalizedDomain {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, error: "Domain is required (received an empty value)." };
  }
  let host: string;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    host = new URL(hasScheme ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return { ok: false, error: `"${raw}" is not a valid domain or URL.` };
  }
  const domain = host.toLowerCase().replace(/\.+$/, "");
  if (!DOMAIN_RE.test(domain)) {
    return {
      ok: false,
      error: `"${raw}" is not a valid domain — expected a host like "example.com".`,
    };
  }
  // Reject internal / reserved names that pass DOMAIN_RE but must never be tracked or
  // crawled (foo.internal, metadata.google.internal, x.local, a.test, ...). The crawl-time
  // origin gate (crawler/ssrf.ts) additionally refuses any PRE-EXISTING stored domain that
  // would only now be judged non-public.
  if (nonPublicHostnameReason(domain) !== null) {
    return {
      ok: false,
      error: `"${raw}" is not a public domain — internal or reserved names cannot be tracked.`,
    };
  }
  return { ok: true, domain };
}

/** What happened to the project row: it was inserted, it was already active, or it came back. */
export type ProjectOutcome = "created" | "existing" | "restored";

/** The project a tracking request landed on, and how it got there. */
export interface TrackedProject {
  readonly id: string;
  readonly domain: string;
  readonly outcome: ProjectOutcome;
}

/** A project request that resolved, or the one sentence explaining why it could not. */
export type ProjectResolution =
  | { readonly ok: true; readonly project: TrackedProject }
  | { readonly ok: false; readonly error: string };

/**
 * THE project-opening route: normalize the domain, then create the project, return the
 * existing one, or restore it from the archive — the whole invariant described in this
 * module's header, in one function.
 *
 * It is a function rather than inline handler code because setup_project is no longer its
 * only caller: track_gsc_property opens a project from a Search Console property string and
 * routes through HERE. That matters beyond tidiness. `propertyToDomain` (packages/core) only
 * checks a domain's SHAPE, so it accepts hosts `normalizeDomain` refuses — `foo.internal`,
 * `x.local`, `a.test`. A second creation route would write those rows straight past a gate
 * this one enforces; there is one route, so there is one gate.
 */
export async function openTrackedProject(
  userId: string,
  rawDomain: string,
): Promise<ProjectResolution> {
  const normalized = normalizeDomain(rawDomain);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  const { domain } = normalized;
  const client = getServiceClient();

  const existing = await readProject(client, userId, domain);
  if (existing) {
    return await resolveExisting(client, userId, domain, existing);
  }

  // Race-safe insert: ON CONFLICT (user_id, domain) DO NOTHING (ignoreDuplicates). A row is
  // returned ONLY when THIS call inserted it (created: true); an empty result means a
  // concurrent first call won the row between our read and this write, so we read it back
  // and report created: false — one row, consistent flags, no unique-violation surfaced.
  const upserted = await client
    .from("projects")
    .upsert({ user_id: userId, domain }, {
      onConflict: "user_id,domain",
      ignoreDuplicates: true,
    })
    .select("id");
  if (upserted.error) {
    throw new Error(`projects upsert failed: ${upserted.error.message}`);
  }
  const insertedId = upserted.data?.[0]?.id;
  if (insertedId) {
    return { ok: true, project: { id: insertedId, domain, outcome: "created" } };
  }

  const winner = await readProject(client, userId, domain);
  if (!winner) {
    throw new Error("projects upsert reported a conflict but no existing row was found");
  }
  return await resolveExisting(client, userId, domain, winner);
}

/** setup_project's own wording for each outcome — unchanged, and its alone. */
function renderSetupOutcome(project: TrackedProject): string {
  if (project.outcome === "created") {
    return `Created project for "${project.domain}" (project_id: ${project.id}, created: true).`;
  }
  if (project.outcome === "restored") {
    return (
      `Restored "${project.domain}" from your archive — it is tracked again ` +
      `(project_id: ${project.id}, created: false).`
    );
  }
  return `Project already exists for "${project.domain}" (project_id: ${project.id}, created: false).`;
}

export const setupProjectTool = defineTool({
  name: "setup_project",
  description:
    "Register a website domain to track. Accepts a domain or URL; returns the project id. " +
    "Idempotent — calling it again for the same domain returns the existing project.",
  inputSchema: z.object({
    domain: z
      .string()
      .min(1)
      .describe("The website to track, e.g. \"example.com\" or \"https://example.com\"."),
  }),
  handler: async (ctx, { domain }) => {
    const resolved = await openTrackedProject(ctx.userId, domain);
    return resolved.ok
      ? textResult(renderSetupOutcome(resolved.project))
      : errorResult(resolved.error);
  },
});

/** An existing project row as this tool needs it: its id and whether it sits in the archive. */
type ProjectRow = { readonly id: string; readonly archived_at: string | null };

/**
 * Tenant-scoped read of a project by (user_id, domain); null when absent. Deliberately
 * unfiltered on archived_at: an archived row still OCCUPIES the (user_id, domain) unique
 * slot (migration 0010), so hiding it here would only send the insert into a conflict it
 * cannot resolve.
 */
async function readProject(
  client: ReturnType<typeof getServiceClient>,
  userId: string,
  domain: string,
): Promise<ProjectRow | null> {
  const { data, error } = await client
    .from("projects")
    .select("id, archived_at")
    .eq("user_id", userId)
    .eq("domain", domain)
    .maybeSingle();
  if (error) {
    throw new Error(`projects lookup failed: ${error.message}`);
  }
  return data;
}

/**
 * Report the row that already holds this domain — restoring it first when the tenant had
 * archived it. Restoring is the only correct answer there: a second row is impossible
 * (unique (user_id, domain), migration 0010), and would in any case orphan the crawls,
 * reports and Search Console link that hang off the original id. So setting a domain up
 * again picks the same project back up rather than starting an empty one.
 */
async function resolveExisting(
  client: ReturnType<typeof getServiceClient>,
  userId: string,
  domain: string,
  row: ProjectRow,
): Promise<ProjectResolution> {
  if (row.archived_at === null) {
    return { ok: true, project: { id: row.id, domain, outcome: "existing" } };
  }
  const { error } = await client
    .from("projects")
    .update({ archived_at: null })
    .eq("id", row.id)
    // The tenant filter belongs on the WRITE too, not only on the read that found the row
    // (constitution NEVER #4) — this client bypasses RLS, so the filter is the whole guard.
    .eq("user_id", userId);
  if (error) {
    throw new Error(`projects restore failed: ${error.message}`);
  }
  return { ok: true, project: { id: row.id, domain, outcome: "restored" } };
}
