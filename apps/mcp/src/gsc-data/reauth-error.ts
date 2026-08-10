/**
 * The one Search Console failure the USER can clear without an operator: Google refused the
 * stored refresh token outright, and re-approving access mints a new one.
 *
 * MEASURED 2026-08-09 (docs/testing/2026-08-09-cok-site-kampanya.md): 12 live cells answered
 * `pull_gsc_data` with "failed unexpectedly — quote reference 3f9c1a20" while the server log
 * said `invalid_grant`. The user was charged 5 credits for a call that could never have
 * succeeded, and was told to file a bug about a credential they could have replaced in a
 * minute.
 *
 * TYPED, not text-matched, because the registry's branch must key on the TYPE — the same rule
 * PreconditionNotMetError states, for the same reason: a plain Error carrying similar words is
 * still an unexplained throw and belongs in the generic branch.
 *
 * THROWN, not returned, because that is what makes it FREE: withCredits commits a handler that
 * RETURNS and releases only on a THROW (credits/guard.ts). An errorResult here would charge for
 * a failure the caller cannot avoid. The actionable sentence therefore cannot come from the
 * handler — it comes from the registry's branch, built out of the two fields below.
 */

export class GscReauthRequiredError extends Error {
  constructor(
    readonly accountEmail: string,
    /**
     * The link that revives the connection, or null when there is no honest one to give — i.e.
     * WEB_BASE_URL is unset. Nullable by controller ruling, widened from the brief's
     * `reconnectUrl: string`: with a non-nullable field the only way to signal a missing base URL
     * was to let the URL builder throw, which dropped this refusal back into the generic
     * "failed unexpectedly — quote reference …" branch. That is the exact sentence this class
     * exists to abolish, reappearing in the exact situation it was written for. A guarantee that
     * holds only on a well-configured deployment is not a guarantee (signed lessons 5 and 6).
     *
     * Null means the LINK is missing, never the instruction: renderReconnectInstruction below
     * still tells the user where to go. Fabricating an origin was considered and rejected —
     * inventing an endpoint is NEVER #9, and a wrong link is worse than no link.
     */
    readonly reconnectUrl: string | null,
  ) {
    super(`Google Search Console connection for ${accountEmail} expired`);
    this.name = "GscReauthRequiredError";
  }
}

/**
 * "Here is where you fix it" — with a link when there is one, and by NAME when there is not.
 * "Connection" is the real page: `/app/connection`, the nav label in apps/web/app/app/layout.tsx
 * and the `<h1>` on the page itself, so this names something the user can actually find rather
 * than a plausible-sounding invention. Same shape as the paid-balance refusal's billing fallback,
 * for the same reason.
 *
 * ONE renderer for both surfaces — the registry's typed refusal and the discovery tools' staleness
 * warning — because two copies of a fallback are two chances for only one of them to be fixed.
 */
export function renderReconnectInstruction(reconnectUrl: string | null): string {
  return reconnectUrl
    ? `Reconnect: ${reconnectUrl}`
    : "Reconnect it from the Connection page in your SeoGrep dashboard.";
}

/**
 * Narrow an unknown error to the reauth refusal.
 *
 * `instanceof` ALONE, deliberately — unlike isPaidBalanceRequired / isPreconditionNotMet, which
 * also accept a name match so they survive a duplicated module instance. Those two carry nothing
 * but a message; this one carries DATA the registry reads, so a name-only match would render
 * "connection for undefined expired. Reconnect: undefined" — a worse answer than the generic
 * sentence it replaced. Both producer (pull-gsc-data.ts) and consumer (registry.ts) import this
 * module by the same specifier inside one app, so there is one class to be an instance of.
 */
export function isGscReauthRequired(error: unknown): error is GscReauthRequiredError {
  return error instanceof GscReauthRequiredError;
}

/**
 * Google's token endpoint names the failure in its own `error` field; @pseo/core's `tokenError`
 * renders a failed refresh as `` `Google token endpoint failed (<status>): <code>` ``. Matching
 * the code at the message's TAIL — never a bare substring test — is what keeps a 5xx, a timeout
 * or a network error (whose message never ends in `: invalid_grant`) from being mistaken for a
 * dead credential.
 *
 * That distinction is the whole point of the classifier: "reconnect your Google account" and
 * "try again in a minute" are different instructions, and handing the first one out for a
 * transient blip sends a user through an OAuth round for nothing — and marks a perfectly live
 * account invalid in the database (migration 0021's own note on the column).
 *
 * Duplicated from apps/web/lib/gsc/accounts.ts on purpose: apps/mcp depends on @pseo/core and
 * @supabase/supabase-js only, never on apps/web, and this classifier cannot move to
 * packages/core without dragging Supabase in beside zod. Same convention as the hand-declared
 * gsc_accounts row shape in db.ts.
 */
const INVALID_GRANT_SUFFIX = /:\s*invalid_grant$/;

export function isInvalidGrant(error: unknown): boolean {
  return error instanceof Error && INVALID_GRANT_SUFFIX.test(error.message);
}
