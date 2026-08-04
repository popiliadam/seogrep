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
