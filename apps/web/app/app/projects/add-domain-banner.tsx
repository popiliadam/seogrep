/**
 * The banner /app/projects renders after the "Add domain" form ran. The action is a POST that
 * ends in a redirect, so its ONLY channel back to the page is the query string: `?added=` with
 * the outcome the shared route reported (`created` | `existing` | `restored`) plus the
 * normalized `?domain=`, or `?error=` with a code.
 *
 * Purely presentational — no data access, no interactivity — so it stays a server component,
 * and it is modelled on `components/gsc-banner.tsx` including the rule that matters most here:
 * EVERY MESSAGE IS A LITERAL. The query string is attacker-controlled (a link is enough), so an
 * unknown `added` / `error` value renders nothing at all rather than being echoed, and the
 * lookups are Maps (not records) so an inherited key like "constructor" cannot resolve.
 *
 * `domain` is the one value that reaches the page as TEXT, because "Now tracking example.com."
 * is worth considerably more than "Now tracking that domain." — so it is gated on SHAPE before
 * it is rendered: the action only ever emits a domain that `normalizeDomain` returned, and
 * anything that does not look like one falls back to the domain-less wording. React escapes the
 * text either way; the gate is about what the page is willing to SAY, not about markup.
 */

type BannerTone = "success" | "notice" | "error";

/** Manpage callout: 2px left border on the card surface; tone shows in the border + text. */
const TONE_STYLES: Readonly<Record<BannerTone, string>> = {
  success: "border-l-positive text-positive",
  notice: "border-l-accent text-warn",
  error: "border-l-negative text-negative",
};

/**
 * What a normalized domain looks like — lowercase labels, at least one dot, no scheme, no path.
 * Deliberately stricter than the action's own gate rather than a second copy of it: this is not
 * deciding whether a domain may be TRACKED (that ruling belongs to `normalizeDomain`, and it has
 * already been made by the time this renders), only whether a string off the URL bar is
 * domain-shaped enough to be repeated back to the user.
 */
const DOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** The domain to name in the copy, or null when the param is missing or not domain-shaped. */
function namedDomain(domain?: string): string | null {
  return domain !== undefined && domain.length <= 253 && DOMAIN_SHAPE.test(domain) ? domain : null;
}

/** One outcome's copy, with and without a usable domain to name. */
interface OutcomeCopy {
  readonly tone: BannerTone;
  readonly withDomain: (domain: string) => string;
  readonly withoutDomain: string;
}

const OUTCOMES: ReadonlyMap<string, OutcomeCopy> = new Map([
  [
    "created",
    {
      tone: "success",
      withDomain: (domain: string) => `Now tracking ${domain}.`,
      withoutDomain: "Now tracking that domain.",
    },
  ],
  [
    "existing",
    {
      tone: "notice",
      withDomain: (domain: string) => `You were already tracking ${domain}.`,
      withoutDomain: "You were already tracking that domain.",
    },
  ],
  [
    "restored",
    {
      tone: "success",
      withDomain: (domain: string) => `${domain} is back — restored from your archive.`,
      withoutDomain: "That domain is back — restored from your archive.",
    },
  ],
]);

/**
 * The refusals the action can redirect with. Each is a LITERAL sentence chosen for this surface;
 * the MCP tool's own wording for the same refusal stays in apps/mcp, which is the established
 * split (`ARCHIVED_PROJECT` in connection/action-support.ts has the same relationship to
 * `ARCHIVED_PROJECT_MESSAGE` in project-target.ts): same verdict, surface-appropriate sentence.
 */
const ERRORS: ReadonlyMap<string, string> = new Map([
  [
    "invalid_domain",
    "That is not a domain SeoGrep can track. Enter a public domain such as example.com — " +
      "internal and reserved names (.internal, .local, .test) are not supported.",
  ],
  [
    "not_restored",
    "That domain is still in your archive — it changed while this ran, so nothing was tracked. " +
      "Please try again.",
  ],
  ["failed", "Could not add that domain. Please try again."],
]);

interface BannerMessage {
  readonly tone: BannerTone;
  readonly text: string;
}

/** The message for one return, or null when there is no (known) outcome to report. */
export function addDomainMessage(
  added?: string,
  domain?: string,
  error?: string,
): BannerMessage | null {
  if (added !== undefined) {
    const copy = OUTCOMES.get(added);
    if (copy === undefined) {
      return null;
    }
    const named = namedDomain(domain);
    return { tone: copy.tone, text: named === null ? copy.withoutDomain : copy.withDomain(named) };
  }
  if (error !== undefined) {
    const text = ERRORS.get(error);
    return text === undefined ? null : { tone: "error", text };
  }
  return null;
}

/** Renders what the Add-domain form did, or nothing when the page was not reached through it. */
export function AddDomainBanner({
  added,
  domain,
  error,
}: {
  added?: string;
  domain?: string;
  error?: string;
}) {
  const message = addDomainMessage(added, domain, error);
  if (message === null) {
    return null;
  }
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={`m-0 border-l-2 bg-card px-4 py-3 font-mono text-[12.5px] leading-[1.6] ${TONE_STYLES[message.tone]}`}
    >
      {message.text}
    </p>
  );
}
