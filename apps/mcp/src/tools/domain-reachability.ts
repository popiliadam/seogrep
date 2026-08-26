import type { DomainReachability } from "@pseo/core";

/**
 * setup_project's and whats_next's DNS answer — the PORT itself now lives in @pseo/core
 * (`net/reachability.ts`), and what stays here is this surface's WORDING.
 *
 * WHY IT SPLIT (2026-08-26). The panel's "Add domain" form shares the project-opening route with
 * `setup_project` but is a different app, so it could not reach the check at all: the same
 * mistyped domain produced a warning through the MCP tool and total silence through the panel.
 * The classifier ("did DNS say no, or did DNS not answer?") is the one judgement here that must
 * not be got backwards, so it moved to the package BOTH apps already depend on rather than being
 * copied into the second one.
 *
 * The sentence did NOT move with it. Every user-facing surface owns its own copy — apps/web
 * renders a banner literal chosen for a page, this one appends a paragraph to a tool result —
 * which is the established split on this codebase (`ARCHIVED_PROJECT` in the panel next to
 * `ARCHIVED_PROJECT_MESSAGE` in project-target.ts): same verdict, surface-appropriate sentence.
 *
 * Re-exported from here so every existing caller and pin (`setup-project.ts`, `whats-next.ts`,
 * and their suites) is unchanged by the move.
 */
export {
  checkDomainReachable,
  classifyLookupFailure,
  DOMAIN_LOOKUP_TIMEOUT_MS,
  type CheckDomainFn,
  type DomainReachability,
} from "@pseo/core";

/**
 * The warning line, or "" when there is nothing to warn about.
 *
 * Appended to a SUCCESS message, never substituted for one: the project was created, and the
 * sentence says so before this line is reached. It names both innocent explanations, because the
 * common case for a domain that does not resolve is a site that is not live yet — a customer who
 * is told "this looks wrong" about a correct decision stops reading the warnings that matter.
 */
export function reachabilityWarning(domain: string, result: DomainReachability): string {
  if (result !== "no_such_domain") return "";
  return (
    `\n\nHeads up: ${domain} does not resolve — a DNS lookup found no such name. The project ` +
    "is registered and ready, but a crawl would have nothing to fetch until the domain is " +
    "live. If the site is not launched yet, that is expected. If the domain was mistyped, run " +
    "setup_project again with the correct one."
  );
}
