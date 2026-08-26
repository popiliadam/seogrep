import type { DomainReachability } from "@pseo/core";
import type { ProjectOutcome } from "@pseo/db/projects";

/**
 * THE QUERY-STRING CONTRACT between the "Add domain" action and the page it redirects back to.
 *
 * It is a module of its own for the same reason `connection/action-support.ts` is: a
 * `"use server"` file may export nothing but async functions, so the action cannot own the
 * constants and pure builders it needs, and `add-domain-banner.tsx` must read the SAME names the
 * action writes. Both sides import from here, so a renamed code is a compile error rather than a
 * banner that silently renders nothing.
 *
 * The action's channel back to the page is the URL and only the URL — a POST that ends in a
 * redirect (POST-redirect-GET, so a refresh never re-submits). Which means everything below
 * arrives back through the BROWSER and is attacker-controllable; the banner treats it that way.
 */

/** The page the form lives on, revalidated and redirected to. */
export const PROJECTS_PATH = "/app/projects";

/**
 * Why a domain was not added. A CODE, never the sentence: the sentence is chosen by the page
 * (banner literals), so nothing the server writes into the URL is ever echoed into the document.
 *
 *   invalid_domain — the shared route's `normalizeDomain` gate refused the host.
 *   not_restored   — the domain was in the archive and the un-archiving write matched no row.
 *   failed         — the statement itself failed.
 */
export type AddDomainError = "invalid_domain" | "not_restored" | "failed";

/**
 * Where the page lands after the domain was opened. `outcome` comes straight from the shared
 * route (`created` | `existing` | `restored`) rather than from a second vocabulary here, so the
 * panel cannot drift from what `setup_project` reports for the same three situations.
 *
 * `domain` is the NORMALIZED one the route returned, not the raw input — the banner names it in
 * the copy, and what the user typed may be a URL, uppercase, or carry a port.
 */
export function addedUrl(
  outcome: ProjectOutcome,
  domain: string,
  reachability: DomainReachability = "unknown",
): string {
  const base = `${PROJECTS_PATH}?added=${outcome}&domain=${encodeURIComponent(domain)}`;
  // ONLY the positive finding travels. `resolves` and `unknown` are both "nothing to say" — a
  // lookup that timed out must never reach the page as a claim about the customer's domain — so
  // they add no parameter at all and the banner has nothing to render.
  return reachability === "no_such_domain" ? `${base}&dns=no_such_domain` : base;
}

/** The one reachability value the page reacts to. A CODE, like every other value in this URL. */
export const DNS_NO_SUCH_DOMAIN = "no_such_domain";

/** Where the page lands after a refusal. */
export function errorUrl(code: AddDomainError): string {
  return `${PROJECTS_PATH}?error=${code}`;
}
