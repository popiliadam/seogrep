import { z } from "zod";
import { forUser, getServiceClient } from "../db.ts";
import { normalizeDomain } from "./setup-project.ts";

/**
 * Shared "what domain am I looking at?" resolver for the domain-scoped premium tools
 * (ranked_keywords / compare_competitors / analyze_backlinks).
 *
 * Each of those tools used to take a bare `target`. They now accept EITHER a `target` (any
 * public domain, including a competitor's) OR a `project_id` (one of the caller's own
 * projects, whose domain is then used as the target) — exactly one of the two.
 *
 * Two properties this module exists to guarantee:
 *   1. Every rejection here is FREE. All three tools are charge:"handler" and call this
 *      BEFORE opening a credit reserve, so a call rejected here writes ZERO ledger rows
 *      (constitution NEVER #2). Nothing in this module reserves, commits, or prices.
 *   2. The project read is TENANT-SCOPED (constitution NEVER #4). It goes through
 *      forUser(...).selectOwnById, whose `.eq("user_id", …)` filter is the guard on the
 *      RLS-bypassing service client. A project that does not exist and a project owned by
 *      another tenant both read as null and produce the SAME sentence, so the tool cannot be
 *      used to probe which project ids exist (the get_job_status pattern).
 */

/** A tenant's project as the domain tools need it: the id they passed and the domain to use. */
export interface ProjectRef {
  readonly id: string;
  readonly domain: string;
}

/** Tenant-scoped project loader. Injected in tests; the default reads the real table. */
export type LoadProjectFn = (userId: string, projectId: string) => Promise<ProjectRef | null>;

/**
 * The production loader: a tenant-scoped single-row read. Missing and other-tenant both
 * return null — selectOwnById filters on user_id, so the two are indistinguishable here.
 */
export async function loadOwnProject(
  userId: string,
  projectId: string,
): Promise<ProjectRef | null> {
  return forUser(getServiceClient(), userId).selectOwnById<ProjectRef>(
    "projects",
    projectId,
    "id, domain",
  );
}

/** The optional `project_id` input field, worded the same way in all three tools. */
export const projectIdField = z
  .uuid()
  .optional()
  .describe(
    "One of your projects (from setup_project / list_projects) — the domain is taken from it. " +
      "Pass this OR target, not both.",
  );

/** The optional `target` input field, worded the same way in all three tools. */
export function targetField(what: string): z.ZodOptional<z.ZodString> {
  return z
    .string()
    .min(1)
    .optional()
    .describe(
      `The domain to ${what}, e.g. "example.com" or "https://example.com" — any public domain, ` +
        "including a competitor's. Pass this OR project_id, not both.",
    );
}

/** A resolved lookup subject: the domain to query, plus the project it came from (if any). */
export type TargetResolution =
  | { readonly ok: true; readonly domain: string; readonly project: ProjectRef | null }
  | { readonly ok: false; readonly error: string };

/** Neither input given: there is nothing to look up. */
export const NO_SUBJECT_MESSAGE =
  'Nothing to look up: pass "project_id" (one of your projects, from list_projects) or ' +
  '"target" (any public domain). You were not charged.';

/**
 * BOTH inputs given. They are rejected rather than resolved by precedence: the two can name
 * different domains, and every precedence rule silently bills a lookup of the domain the caller
 * did NOT mean. These tools cost 65-90 credits a call, so guessing is the expensive answer.
 */
export const AMBIGUOUS_SUBJECT_MESSAGE =
  'Pass "project_id" or "target", not both — they can name different domains and SeoGrep will ' +
  "not guess which one you meant. Drop one and run it again. You were not charged.";

/**
 * The one sentence a project id that did not resolve gets. It interpolates ONLY the id the
 * caller supplied, so an unknown id and another tenant's id produce byte-identical text.
 */
export function projectNotFoundMessage(projectId: string): string {
  return (
    `No project found with id ${projectId}. Run list_projects to see your projects, or create ` +
    "one with setup_project. You were not charged."
  );
}

/**
 * Resolve the domain a call is about. Free and pre-reserve — call it before withCredits.
 *
 * A `project_id` costs one tenant-scoped read; a bare `target` reads nothing at all, so the
 * project-less path still works on a deployment whose DB is unreachable.
 *
 * The project's stored domain goes through the SAME normalizer a caller-supplied target does.
 * setup_project stores canonical domains, so this is normally a no-op; it is not skipped
 * because a row that predates a normalizer change would otherwise reach DataForSEO unchecked.
 */
export async function resolveTarget(
  userId: string,
  input: { readonly target?: string; readonly project_id?: string },
  loadProject: LoadProjectFn,
): Promise<TargetResolution> {
  const { target, project_id: projectId } = input;
  if (target !== undefined && projectId !== undefined) {
    return { ok: false, error: AMBIGUOUS_SUBJECT_MESSAGE };
  }
  if (target === undefined && projectId === undefined) {
    return { ok: false, error: NO_SUBJECT_MESSAGE };
  }
  if (projectId !== undefined) {
    const project = await loadProject(userId, projectId);
    if (!project) {
      return { ok: false, error: projectNotFoundMessage(projectId) };
    }
    const normalized = normalizeDomain(project.domain);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error };
    }
    return { ok: true, domain: normalized.domain, project };
  }
  const normalized = normalizeDomain(target as string);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  return { ok: true, domain: normalized.domain, project: null };
}

/**
 * How a heading names what was looked up: a bare quoted domain, or the project it was resolved
 * from. When a project resolved, its domain IS the target, so naming both would just repeat
 * itself — the project wording says where the domain came from and names it in one clause.
 */
export function subjectLabel(target: string, project: ProjectRef | null | undefined): string {
  return project ? `your project "${project.domain}"` : `"${target}"`;
}
