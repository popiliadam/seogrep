// Redaction for the tool sweep — the one thing that must never fail open.
//
// The sweep's endpoint is a single URL whose PATH carries the API key, so the URL is a
// credential, not an address: anything that prints or persists it has leaked the account.
// Every string this harness writes to disk or to the terminal goes through the redactor
// built here, and the runner redacts the SERIALISED record rather than hand-picked fields
// — a field allowlist is a thing a future field can be forgotten from.
//
// The secrets are DERIVED from the URL at runtime. Nothing in this directory contains a
// real key, and no key prefix is hardcoded: a path segment is treated as secret purely by
// shape (>= MIN_SECRET_SEGMENT chars of key-alphabet). That rule survives a key format
// change; a hardcoded prefix would not.
//
// Substitution is plain string replacement, never a regex built from the secret: a key can
// contain regex metacharacters, and a mis-escaped pattern that silently matches nothing is
// exactly the failure mode this module exists to prevent.

/** The single placeholder every secret collapses to. The only such literal in this directory. */
export const REDACTED = "sg_***redacted";

/**
 * Shortest path segment treated as a credential. 12 is comfortably below any key this
 * product issues (the live endpoint's key segment is 36 chars) and comfortably above the
 * routing segments that share the path ("mcp"), so it errs toward over-redaction — the
 * safe direction when the alternative is printing a key.
 */
const MIN_SECRET_SEGMENT = 12;

const SECRET_SEGMENT = new RegExp(`^[A-Za-z0-9_-]{${MIN_SECRET_SEGMENT},}$`);

/**
 * Every literal that must never appear in output, longest first. Order matters: the full
 * URL is replaced before its own key segment, so a logged URL collapses to ONE placeholder
 * instead of a half-redacted string that still shows the host and path shape.
 */
export function secretsOf(endpointUrl) {
  const raw = String(endpointUrl ?? "").trim();
  if (raw.length === 0) return [];
  const found = [raw, raw.replace(/\/+$/, "")];
  try {
    const parsed = new URL(raw);
    found.push(parsed.href);
    for (const segment of parsed.pathname.split("/")) {
      if (SECRET_SEGMENT.test(segment)) found.push(segment);
    }
    if (parsed.search.length > 1) found.push(parsed.search.slice(1));
  } catch {
    // Not parseable as a URL. The whole string is already in `found`, which is the
    // conservative answer: redact all of it rather than guess at its structure.
  }
  return [...new Set(found)].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
}

/**
 * Build the redactor for one endpoint. Returns a pure function: it never mutates its input
 * (global immutability rule) and holds no state, so it is safe to hand to the recorder, the
 * logger and the self-test alike.
 */
export function makeRedactor(endpointUrl) {
  const secrets = secretsOf(endpointUrl);
  return function redact(value) {
    let out = typeof value === "string" ? value : String(value);
    for (const secret of secrets) out = out.split(secret).join(REDACTED);
    return out;
  };
}

/** A redactor for the paths that have no endpoint (self-test, dry-run without env). */
export const identityRedactor = (value) => (typeof value === "string" ? value : String(value));
