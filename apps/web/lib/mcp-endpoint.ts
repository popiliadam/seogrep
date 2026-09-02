/**
 * The fixed, key-free MCP endpoint: the personal-URL template with its trailing `/{key}` segment
 * removed. That address is what header auth uses (`x-api-key: <key>`), which the MCP server accepts
 * alongside the URL-with-key form.
 *
 * Derived from the SAME template the personal URL is built from (`mcpUrlTemplate()`), never
 * hardcoded — a second literal endpoint here would silently drift the day MCP_URL_TEMPLATE points
 * somewhere else. Pure: the caller passes the template in, so nothing reads env at import time.
 *
 * Returns null when the template has no `/{key}` segment to strip, so a caller shows nothing rather
 * than inventing an address (constitution NEVER #9 — no fabricated endpoints).
 */
export function mcpHeaderEndpoint(template: string): string | null {
  const match = template.trim().match(/^(\S+)\/\{key\}\/*$/);
  return match?.[1] ?? null;
}

/**
 * The personal MCP URL split around its `{key}` placeholder, for marketing surfaces that show the
 * shape of the address with the key styled or masked: render `before`, then the key, then `after`.
 *
 * WHY THIS EXISTS AND NOT A LITERAL. Two marketing pages published
 * `https://mcp.seogrep.com/u/<key>/mcp` while the real template — the one the dashboard renders and
 * the server routes — is `https://mcp.seogrep.com/mcp/{key}`. A new user who copied the landing
 * page's address could not connect at all (M-04, audit 2026-08-26). The file that already forbade
 * this is THIS one: mcpHeaderEndpoint's header says a second literal endpoint would silently drift.
 * The rule was written; what was missing was a helper for the one shape marketing needed, so the
 * pages reached for a literal instead.
 *
 * Handles a placeholder anywhere in the template, not just the last segment — the old `/u/{key}/mcp`
 * form is exactly the case with a non-empty `after`, so this cannot be right only for today's shape.
 *
 * Returns null when the template has no placeholder at all, so a caller shows nothing rather than
 * inventing an address (constitution NEVER #9).
 */
export function mcpUrlDisplayParts(template: string): { before: string; after: string } | null {
  const at = template.indexOf("{key}");
  if (at === -1) return null;
  return { before: template.slice(0, at), after: template.slice(at + "{key}".length) };
}
