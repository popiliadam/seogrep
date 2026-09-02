import type { AuditPage } from "../crawl-data.ts";
import { urlKey } from "./url-key.ts";

/**
 * The hreflang rules (part of audit_tech): CODE FORMAT (R-4.11) and RECIPROCITY (R-4.10).
 *
 * Both are computable from ONE crawl and neither costs a request: the crawler already stores every
 * `<link rel="alternate" hreflang=…>` it saw, and reciprocity is a question about two pages that
 * are both in the same crawl. Until 2026-09-02 that data had no reader at all.
 *
 * WHAT THESE RULES DELIBERATELY DO NOT CLAIM:
 *  - a hreflang served in an HTTP header or a sitemap is not seen here (the crawler reads the HTML
 *    channel), so a "not reciprocated" row means the RETURN LINK IS NOT IN THE HTML;
 *  - a target outside this crawl, or one whose own alternates were never stored, is COUNTED as
 *    unmeasured rather than accused — the crawl is bounded, and its bounds are not the site's;
 *  - the code check reads the CODE. `uk` is Ukrainian; a site that meant the United Kingdom has a
 *    working tag pointed at the wrong audience, and nothing in the string says so.
 */

/** One alternate whose language code cannot be what the page meant (R-4.11). */
export interface HreflangCodeIssue {
  readonly url: string;
  /** The value AS DECLARED, so the reader can find it in their template. */
  readonly lang: string;
  /** Why it cannot work, in the reply's own words. */
  readonly reason: string;
}

/** An alternate that is not returned: `from` names `to`, and `to` names nothing back (R-4.10). */
export interface HreflangGap {
  readonly from: string;
  readonly to: string;
  /** The code `from` used for `to` — the row of the table that is being ignored. */
  readonly lang: string;
}

export interface HreflangReport {
  readonly invalidCodes: HreflangCodeIssue[];
  readonly missingXDefault: string[];
  readonly notReciprocated: HreflangGap[];
  /**
   * Alternates whose target this crawl could not check — outside the crawl, or a page whose own
   * alternates were never stored. Reported as a NUMBER next to the findings so the reciprocity
   * count is never read as "everything else was checked and is fine".
   */
  readonly unmeasuredTargets: number;
}

/**
 * ISO 639-1, the two-letter language set R-4.11 names. A table rather than a shape check, because
 * the mistake it exists to catch — a REGION where a language belongs (`hreflang="us"`) — is
 * shaped exactly like a language and can only be told apart by looking it up.
 */
const ISO_639_1 = new Set(
  ("aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy " +
    "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu " +
    "hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb " +
    "lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om " +
    "or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw " +
    "ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu").split(" "),
);

/** ISO 3166-1 has no code for "the EU" or "the UN"; Google reads these as nothing. */
const RESERVED_REGIONS = new Set(["eu", "un"]);

const SHAPE_ADVICE =
  "expected a language like en, or a language and region like en-GB";

/** Why this value cannot work as an hreflang, or null when it can. */
function codeProblem(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value === "x-default") return null;
  const parts = value.split("-");
  const [language, ...rest] = parts;
  if (language === undefined || rest.length > 2) return `"${raw}" is not a valid hreflang value (${SHAPE_ADVICE})`;
  if (!ISO_639_1.has(language)) {
    return language.length === 2
      ? `"${raw}" does not start with an ISO 639-1 language code — a region cannot be given on its own`
      : `"${raw}" is not a valid hreflang value (${SHAPE_ADVICE})`;
  }
  // lang[-script][-region]: a script subtag is four letters, a region two.
  const region = rest.length === 2 ? rest[1] : rest[0];
  if (rest.length === 2 && !/^[a-z]{4}$/u.test(rest[0] ?? "")) {
    return `"${raw}" is not a valid hreflang value (${SHAPE_ADVICE})`;
  }
  if (region === undefined) return null;
  if (/^[a-z]{4}$/u.test(region) && rest.length === 1) return null; // lang-Script
  if (!/^[a-z]{2}$/u.test(region)) return `"${raw}" is not a valid hreflang value (${SHAPE_ADVICE})`;
  if (RESERVED_REGIONS.has(region)) {
    return `"${raw}" uses a reserved region code, which has no effect in Google Search`;
  }
  return null;
}

/** The alternates a page DECLARED, or null when this page was never measured on that axis. */
function alternatesOf(page: AuditPage): readonly { lang: string; href: string }[] | null {
  return page.hreflangs ?? null;
}

/**
 * Run the hreflang rules over a crawl's pages, or return null when NO page carried the field.
 *
 * Null rather than an empty report, and it is the same distinction sitemapDiff draws: an empty
 * report says "we read your alternates and they are consistent", which is precisely the claim a
 * crawl stored before hreflangs existed cannot support.
 */
export function auditHreflang(pages: readonly AuditPage[]): HreflangReport | null {
  const measured = pages.filter((page) => alternatesOf(page) !== null);
  if (measured.length === 0) return null;

  const byKey = new Map(measured.map((page) => [urlKey(page.url), page]));
  const invalidCodes: HreflangCodeIssue[] = [];
  const missingXDefault: string[] = [];
  const notReciprocated: HreflangGap[] = [];
  let unmeasuredTargets = 0;

  for (const page of measured) {
    const alternates = alternatesOf(page) ?? [];
    const seenCodes = new Set<string>();
    for (const { lang } of alternates) {
      const problem = codeProblem(lang);
      // One row per (page, value): a template repeating its broken code on every alternate is one
      // defect to fix, not fifty findings.
      if (problem !== null && !seenCodes.has(lang)) {
        seenCodes.add(lang);
        invalidCodes.push({ url: page.url, lang, reason: problem });
      }
    }

    const hasXDefault = alternates.some((a) => a.lang.trim().toLowerCase() === "x-default");
    if (alternates.length >= 2 && !hasXDefault) missingXDefault.push(page.url);

    const selfKey = urlKey(page.url);
    for (const { lang, href } of alternates) {
      const targetKey = urlKey(href);
      if (targetKey === selfKey) continue; // the self-reference every correct set carries
      const target = byKey.get(targetKey);
      if (target === undefined) {
        unmeasuredTargets += 1;
        continue;
      }
      const returns = (alternatesOf(target) ?? []).some((a) => urlKey(a.href) === selfKey);
      if (!returns) notReciprocated.push({ from: page.url, to: target.url, lang });
    }
  }

  return { invalidCodes, missingXDefault, notReciprocated, unmeasuredTargets };
}
