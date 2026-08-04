export const SITE_URL = "https://seogrep.com";

/**
 * ONE resolver for every "base URL from env" read in the app (L-07). `process.env.X ?? FALLBACK`
 * only fires on null/undefined, so a SET-but-EMPTY value — the classic broken-deploy / empty
 * Netlify variable — survives and every composed link comes out relative ("/app/connection"),
 * which is dead in an inbox and useless as an OAuth redirect. Signed lesson #6: base/connection
 * URL envs are validated by URL STRUCTURE, never by mere presence.
 *
 * "Not a usable absolute http(s) URL" (unset, empty, whitespace, no scheme, wrong scheme,
 * unparseable) all collapse to `undefined`, so the CALLER's own documented fallback takes over
 * — each call site keeps its own policy (window origin / canonical SITE_URL / fail-closed).
 * Trailing slashes are stripped so `${base}/app` can never become `//app`.
 */
export function resolveBaseUrl(raw: string | undefined | null): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}
export const SITE_NAME = "SeoGrep";
export const SITE_DESCRIPTION =
  "SeoGrep is an SEO MCP server: add your personal URL to Claude, Cursor, or Windsurf and run crawls, audits, and Search Console analysis in plain language.";
