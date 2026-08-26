import { lookup } from "node:dns/promises";

/**
 * "Does this domain exist?" — the one DNS question two guide surfaces ask, behind ONE port.
 *
 * WHY IT EXISTS (measured 2026-08-25). `setup_project("bu-domain-kesinlikle-yok-9f3a2c.com")`
 * answered `Created project … (created: true)` in the same successful tone as a real site, and
 * `whats_next` then recommended `crawl_site` — 20 credits — against a name that does not resolve.
 * `connect_gsc` handed out a Google consent link for it, identical to a real project's.
 *
 * WHAT IT DOES NOT DO: block. The operator signed WARN, not block, and the reason is a real
 * customer: a site registered before launch does not resolve yet and is a perfectly legitimate
 * project. Registration always succeeds; what changes is that the answer says what was found.
 */

/**
 * The three answers, and the middle one is the whole design.
 *
 * `no_such_domain` is a POSITIVE finding — DNS answered, and its answer was "no such name".
 * `unknown` is the absence of a finding: the lookup timed out, the resolver was unreachable, the
 * network was down. Collapsing the two would make every registration during a DNS blip warn that
 * the customer's domain does not exist, which is a worse lie than the silence it replaces. Only
 * `no_such_domain` ever produces a warning or moves the router.
 */
export type DomainReachability = "resolves" | "no_such_domain" | "unknown";

/** The port. Injected in tests so no spec ever touches a resolver. */
export type CheckDomainFn = (domain: string) => Promise<DomainReachability>;

/**
 * How long the real check waits before giving up and answering `unknown`.
 *
 * A CEILING ON LATENCY, not a correctness knob. `setup_project` is a 0-credit, sub-second tool
 * and must stay one: this is the most it can add, and it is added AFTER the project row is
 * written (see setup-project.ts), so a hanging resolver can delay the reply and can never delay
 * or prevent the registration itself. A typical cached lookup answers in single-digit
 * milliseconds; an uncached one in tens.
 */
export const DOMAIN_LOOKUP_TIMEOUT_MS = 2_000;

/**
 * A failed DNS lookup, classified — and this is the function that must not be got backwards.
 *
 * Node reports "the name does not exist" as `ENOTFOUND` (and `EAI_NODATA` where the name exists
 * but carries no address record — equally uncrawlable). EVERY OTHER code is the resolver failing
 * to answer, not the domain failing to exist: `EAI_AGAIN` is the classic temporary DNS failure,
 * and an aborted lookup, a refused connection or an unrecognised code are all "we did not find
 * out". Default is `unknown`, so an error shape nobody anticipated degrades to silence rather
 * than to a false accusation about a customer's domain.
 */
export function classifyLookupFailure(error: unknown): DomainReachability {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOTFOUND" || code === "EAI_NODATA" ? "no_such_domain" : "unknown";
}

/**
 * The real check: one A/AAAA lookup, capped at DOMAIN_LOOKUP_TIMEOUT_MS.
 *
 * `lookup`, not `resolve`, deliberately — it goes through the host's own resolver stack, which is
 * the same path the crawler's fetch will take, so "this resolves" here means the same thing it
 * will mean there. The timer is `unref`'d: a pending timeout must never be the reason a process
 * refuses to exit.
 */
export const checkDomainReachable: CheckDomainFn = async (domain) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<DomainReachability>((resolve) => {
    timer = setTimeout(() => resolve("unknown"), DOMAIN_LOOKUP_TIMEOUT_MS);
    timer.unref?.();
  });
  const query = lookup(domain).then(
    (): DomainReachability => "resolves",
    classifyLookupFailure,
  );
  try {
    return await Promise.race([query, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

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
