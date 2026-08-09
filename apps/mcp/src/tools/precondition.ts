/**
 * A tool was called before the thing it reads exists: no crawl yet, no Search Console pull yet.
 * Both are ordinary states on a fresh project, and the sentence that says so is already written
 * at the loader — audit/load.ts NO_CRAWL_MESSAGE, gsc-data/load.ts NO_PULL_MESSAGE — naming what
 * happened and the one tool that clears it.
 *
 * WHY IT MUST BE A THROW, and therefore why it needs a TYPE. On the "surface" charge path
 * withCredits COMMITS a handler that RETURNS and releases only on a THROW, so returning an
 * errorResult here would charge the caller for being told to run crawl_site first. The throw is
 * the money-safe exit — but it lands in the registry's catch beside the genuine crashes, which
 * answers a designed refusal with "failed unexpectedly … quote reference 0edff0bd". Measured in
 * the 2026-08-09 campaign: 26 live cells were answered that way while nothing had gone wrong (18
 * no-crawl, 8 no-pull), and 12 calls that DID genuinely fail were byte-identical to them — the
 * generic sentence did not merely mislead the user, it made the two classes indistinguishable
 * and blocked diagnosis. This type is what lets the registry tell them apart.
 *
 * It lives in the tools layer rather than credits/ because it is not a credits concern: the
 * reserve/release mechanics are unchanged, and an Error subclass is what withCredits already
 * releases on. All this carries is "which of the two things did the catch just catch".
 *
 * WHAT MUST NOT BE ADDED TO IT — and the rule is narrower than "add nothing".
 *
 * The invariant is: NEVER add anything the caller could not already know. Concretely, never say
 * WHICH of the tenant cases it was. The loaders resolve a missing project, another tenant's
 * project and a project never crawled to the SAME message on purpose (audit/load.ts,
 * gsc-data/load.ts). Until now the crash sentence hid that uniformity by accident; the message is
 * user-visible from here on, so the uniformity is load-bearing tenant isolation (NEVER #4).
 *
 * Echoing the caller's OWN project_id back is therefore fine, and two call sites do it
 * (generate-report.ts, pull-gsc-data.ts): it is the argument they just passed in, so it discloses
 * nothing they did not supply, and on those paths the lookup is already tenant-scoped so missing
 * and other-tenant remain indistinguishable. Stating this explicitly because the earlier wording
 * here read as a blanket "no project id" rule and contradicted those two call sites — an
 * ambiguity the next implementer would have resolved in one direction or the other by guessing.
 */
export class PreconditionNotMetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionNotMetError";
  }
}

/**
 * Narrow an unknown error to the pre-condition refusal. The `name` fallback keeps this true
 * across a duplicated module instance (test isolation, bundling), where `instanceof` alone
 * silently answers false — the same hazard isPaidBalanceRequired guards against, and the reason
 * that helper is shaped this way too.
 */
export function isPreconditionNotMet(error: unknown): error is PreconditionNotMetError {
  return (
    error instanceof PreconditionNotMetError ||
    (error instanceof Error && error.name === "PreconditionNotMetError")
  );
}
