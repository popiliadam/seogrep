import { createHash } from "node:crypto";

/**
 * Trial-grant email identity (hostile-audit H-06). Pure: no I/O, no clock, no env.
 *
 * The one-time signup trial is keyed on `auth.uid` alone, so plus-aliased forms of ONE
 * mailbox mint one trial EACH. This module answers the only question that closes that:
 * do two signup addresses reach the same real mailbox? It returns a stable fingerprint
 * (SHA-256 hex) that the DB can store and index as a second dimension beside auth.uid.
 *
 * THE GOVERNING ASYMMETRY. Over-normalising merges two DIFFERENT REAL PEOPLE into one
 * identity, and the second of them is then refused the 200 credits the site advertises.
 * Under-normalising costs a duplicate trial. The first is the worse failure, so every rule
 * below is scoped to where it is ACTUALLY TRUE and the parser fails OPEN (`null`, which
 * the DB reads as "no fingerprint dimension") on anything it cannot confidently parse.
 *
 * NOT SALTED, deliberately: a salt would make the fingerprint un-derivable from the address
 * and rotating it would silently re-arm every trial ever claimed. The plaintext address
 * already sits in `auth.users` next to it, so a salt buys no real secrecy here either.
 */

/** Domains where the mail system genuinely ignores dots in the local part. */
export const DOT_INSENSITIVE_DOMAINS: readonly string[] = ["gmail.com", "googlemail.com"];

/**
 * Domains the provider itself treats as ONE namespace. This map is DELIBERATELY MINIMAL and
 * is NOT a complete census of provider aliasing — do not read it as one.
 *
 * Present: `googlemail.com` -> `gmail.com`, which Google documents as the same mailbox.
 *
 * Absent BECAUSE MERGING WOULD BE WRONG: hotmail.com / outlook.com / live.com are separate
 * Microsoft namespaces — `person@hotmail.com` and `person@outlook.com` can be two different
 * people, so aliasing them would merge strangers. That is the failure mode this whole module
 * is built to avoid.
 *
 * Absent BECAUSE UNVERIFIED, which is a different reason and is recorded separately so nobody
 * mistakes it for the one above: other providers do operate multi-domain namespaces, and a
 * referee measured that we currently treat them as distinct — e.g. `js@proton.me` vs
 * `js@pm.me` vs `js@protonmail.com`, and Apple's icloud.com / me.com / mac.com trio, where a
 * single Apple ID owns all three. Apple's case is the sharpest: merging it would close farming
 * WITHOUT the false-positive risk that correctly rules out the Microsoft set.
 *
 * They stay out because provider policy could not be verified from the build environment, and
 * this repo does not write unmeasured claims into code (signed lesson 9). Adding an entry here
 * is a deliberate act requiring a cited provider policy — not a guess.
 */
const DOMAIN_ALIASES: Readonly<Record<string, string>> = { "googlemail.com": "gmail.com" };

/**
 * Curated, deliberately NON-EXHAUSTIVE list of throwaway-inbox providers. This drives a
 * RECORDED SIGNAL only — never a refusal. A curated list has real false positives, and
 * denying a legitimate user their advertised trial is a worse outcome than granting one to
 * a throwaway address; the operator gets visibility, the user is never silently denied.
 */
export const DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
  "10minutemail.com",
  "20minutemail.com",
  "discard.email",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.com",
  "harakirimail.com",
  "inboxkitten.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "moakt.com",
  "mohmal.com",
  "mytemp.email",
  "sharklasers.com",
  "spam4.me",
  "spamgourmet.com",
  "temp-mail.org",
  "tempinbox.com",
  "tempmail.com",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
];

const DISPOSABLE_SET: ReadonlySet<string> = new Set(DISPOSABLE_EMAIL_DOMAINS);

export interface TrialEmailIdentity {
  /** Normalised local part (before the `@`). */
  readonly localPart: string;
  /** Normalised domain (lowercased, alias-resolved, no trailing root dot). */
  readonly domain: string;
  /** `localPart@domain` — the exact string the fingerprint is taken over. */
  readonly canonical: string;
  /** SHA-256 hex of `canonical`; 64 lowercase hex chars, stable across processes. */
  readonly fingerprint: string;
  /** Advisory signal for the operator. NEVER a reason to withhold the grant. */
  readonly disposableDomain: boolean;
}

/**
 * True when `domain` is a listed throwaway provider or a SUBDOMAIN of one — several of
 * these (mailinator especially) hand out inboxes on arbitrary subdomains. The suffix test
 * is anchored on a dot boundary so `notmailinator.com` does not match.
 */
export function isDisposableEmailDomain(domain: string): boolean {
  const candidate = domain.trim().toLowerCase();
  if (!candidate) return false;
  if (DISPOSABLE_SET.has(candidate)) return true;
  return DISPOSABLE_EMAIL_DOMAINS.some((listed) => candidate.endsWith(`.${listed}`));
}

/**
 * Normalise a signup address to its mailbox identity, or `null` when it cannot be parsed
 * confidently. `null` is the FAIL-OPEN answer: the caller passes no fingerprint and the
 * trial behaves exactly as it did before this module existed.
 */
export function trialEmailIdentity(email: string): TrialEmailIdentity | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim();
  if (!trimmed) return null;

  // RFC 5321: the domain is whatever follows the LAST `@`, because a quoted local part is
  // allowed to contain one (`"weird@local"@example.com`).
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;

  const rawLocal = trimmed.slice(0, at).trim();
  const rawDomain = trimmed.slice(at + 1).trim();
  if (!rawLocal || !rawDomain) return null;

  // Domain: case-insensitive per RFC 1035. A single trailing dot is the FQDN root form of
  // the same domain, so it is dropped. No punycode/IDN folding is attempted — that needs a
  // real IDNA implementation, and guessing would merge domains that are not the same.
  let domain = rawDomain.toLowerCase().replace(/\.$/, "");
  if (!domain) return null;
  domain = DOMAIN_ALIASES[domain] ?? domain;

  // Local part: RFC 5321 §2.4 permits case-SENSITIVE local parts, so lowercasing is not
  // free in theory. It is free here, measured rather than assumed: the identity provider
  // (GoTrue) stores the address already lowercased, so two case variants cannot become two
  // accounts — folding case merges nothing that could otherwise be two real people.
  let localPart = rawLocal.toLowerCase();

  // A quoted local part means its characters are LITERAL, not structural. `+` and `.`
  // inside quotes are ordinary characters, so neither rule below may touch them.
  if (!(localPart.startsWith('"') && localPart.endsWith('"'))) {
    // Plus-alias (RFC 5233 sub-addressing) — applied on every provider. This is the
    // technique the audit found, and effectively every mail system that accepts `+` in a
    // local part routes the sub-address to the base mailbox. Residual risk accepted and
    // recorded: a domain that treats `+` literally would merge two mailboxes.
    const plus = localPart.indexOf("+");
    // A `+` at position 0 would strip the local part to nothing and collapse EVERY
    // `+tag@domain` on that domain into one identity — strangers merged wholesale. Keep
    // the original whenever stripping would empty it.
    if (plus > 0) localPart = localPart.slice(0, plus);

    // Dots — the rule that must NOT be universal. Google documents that gmail ignores them;
    // on Outlook, Yahoo, Fastmail, iCloud, Proton and essentially every corporate domain
    // dots are SIGNIFICANT, and `john.smith@` vs `johnsmith@` are two different people.
    if (DOT_INSENSITIVE_DOMAINS.includes(domain)) {
      const undotted = localPart.replaceAll(".", "");
      if (undotted) localPart = undotted; // same empty-result guard as above
    }
  }

  if (!localPart) return null;

  const canonical = `${localPart}@${domain}`;
  return {
    localPart,
    domain,
    canonical,
    fingerprint: createHash("sha256").update(canonical, "utf8").digest("hex"),
    disposableDomain: isDisposableEmailDomain(domain),
  };
}
