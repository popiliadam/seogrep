import { domainToUnicode } from "node:url";

/**
 * The DISPLAY half of a domain. Storage stays ASCII; this is what a human is shown.
 *
 * WHY IT EXISTS (measured 2026-08-26, smoke tour wave 2). `normalizeDomain` canonicalizes through
 * the URL parser, which applies IDNA — so a customer who registers `örnek.com` is stored, and
 * then SHOWN, as `xn--rnek-4qa.com`. Every surface repeated it: `list_projects`, the panel's
 * project list, the "Now tracking …" banner. The storage is right and must not change — DNS, the
 * crawler's fetch and every vendor join want the A-label — but nothing downstream was turning it
 * back for the person reading it, and in a market whose alphabet leaves ASCII on ordinary words
 * (`çiçek`, `ihtiyaç`, `örnek`) that is most IDN customers.
 *
 * IT IS NOT A SECOND NORMALIZER. It never decides what may be tracked, never feeds a lookup key,
 * and nothing compares its output: `normalizeDomain` remains the only gate, and every stored
 * value, join key and tool argument stays the A-label. Pass its result to a query and you have
 * made a bug — that is why the name says `display`.
 *
 * `node:url` in core is the same liberty `gsc/crypto.ts` and `keys/api-key.ts` already take with
 * `node:crypto`; both apps build against this barrel today.
 */

/** An A-label domain carries at least one `xn--` prefixed label. Cheap pre-check, ASCII only. */
const HAS_A_LABEL = /(^|\.)xn--/i;

/**
 * The scripts this function is willing to SHOW: Latin letters, their marks, and the digits,
 * hyphens and dots a hostname is made of.
 *
 * WHY A WHITELIST AND NOT "DECODE EVERYTHING" — caught by an existing pin, 2026-08-26. The
 * suite already carried `xn--80ak6aa92e.com`, and decoding it produces `аррӏе.com`: five
 * CYRILLIC letters that read as "apple". Punycode is what stands between a homograph and the
 * eye, so a decoder with no script rule does not merely display a name, it renders a disguise.
 *
 * Latin is not a claim that other alphabets matter less; it is the claim this product can
 * currently defend. Deciding that a Greek or Han label is safe to show needs confusable-script
 * analysis (UTS-39), which is a real piece of work and not a regex — so until that exists,
 * anything outside Latin keeps its A-label, which is honest, stable, and exactly what a browser
 * address bar does with the same name. `ö`, `ç`, `ı`, `ü`, `ğ`, `ş` — this market's whole
 * alphabet — are Latin, which is the case that motivated the change.
 */
const SHOWABLE_SCRIPT = /^[\p{Script=Latin}\p{Script=Common}\p{Mark}]+$/u;

/**
 * `domain` as the customer would write it: the U-label when it is punycode, the input otherwise.
 *
 * TOTAL, and deliberately so. `domainToUnicode` answers "" for input it cannot decode (a lone
 * `xn--`, a malformed label), and a surface that printed that would replace a name with nothing —
 * a worse failure than the punycode it set out to fix. Anything that does not decode to a
 * non-empty string comes back exactly as it went in, so this function can be dropped into a
 * template without a guard at every call site.
 */
export function displayDomain(domain: string): string {
  if (!HAS_A_LABEL.test(domain)) return domain;
  const unicode = domainToUnicode(domain);
  if (unicode === "" || !SHOWABLE_SCRIPT.test(unicode)) return domain;
  return unicode;
}

/**
 * The display name, with the stored A-label named after it when the two differ:
 * `örnek.com (xn--rnek-4qa.com)`.
 *
 * For the ONE place where both are owed: a surface whose value the reader may have to type back
 * into a tool, a support ticket or a DNS panel. The plain {@link displayDomain} is for
 * everywhere else — repeating the A-label in every row would reintroduce, as noise, exactly the
 * string this change exists to get out of the way.
 */
export function displayDomainWithAscii(domain: string): string {
  const shown = displayDomain(domain);
  return shown === domain ? domain : `${shown} (${domain})`;
}
