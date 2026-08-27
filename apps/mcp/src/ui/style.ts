import { DARK, LIGHT, type Palette } from "./palette.ts";

/**
 * One theme's custom properties, as a CSS declaration block body.
 *
 * The kebab-case conversion is the one place a key/property mismatch could hide: this regex
 * lower-cases every uppercase letter it finds and prefixes it with a hyphen, so `accentSurface`
 * becomes `accent-surface` and the property is `--sg-accent-surface`. Every reference in this
 * file's own rules below (and any future template consuming `cardCss()`) MUST spell the property
 * the same way this function derives it, or the declaration and the reference silently diverge —
 * a card with invisible text and no error anywhere, because an unmatched `var(--sg-x)` just
 * resolves to nothing rather than throwing.
 */
function variables(palette: Palette): string {
  return Object.entries(palette)
    .map(([name, value]) => `--sg-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value};`)
    .join("\n    ");
}

/**
 * The card's whole stylesheet. NO @import and no url() — the host's default CSP is
 * `default-src 'none'` with inline styles allowed and nothing fetchable, so anything this file
 * asked the network for would simply not arrive and the card would render unstyled.
 *
 * Fonts name the brand faces first and their real fallbacks after: seogrep.com falls back to
 * Georgia and Courier New before its own web fonts load, so the card in a host that supplies no
 * fonts looks like the site's first paint rather than like something else.
 */
export function cardCss(): string {
  return `
  :root {
    ${variables(LIGHT)}
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    ${variables(DARK)}
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 14px;
    background: transparent;
    color: var(--sg-ink);
    font-family: Newsreader, Georgia, serif;
    font-size: 14px;
  }
  .sg-card {
    background: var(--sg-surface);
    border: 1px solid var(--sg-hairline);
    border-radius: 10px;
    padding: 16px 18px;
    max-width: 520px;
  }
  .sg-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    border-bottom: 1px solid var(--sg-hairline);
    padding-bottom: 10px; margin-bottom: 14px;
  }
  .sg-brand { margin: 0; font-size: 14px; letter-spacing: .02em; color: var(--sg-accent); }
  .sg-title { font-size: 12px; color: var(--sg-muted); }
  .sg-badge {
    font-family: "IBM Plex Mono", "Courier New", monospace;
    font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
    background: var(--sg-accent-surface); border: 1px solid var(--sg-accent-edge);
    border-radius: 999px; padding: 2px 8px; color: var(--sg-accent);
  }
  .sg-figure { display: flex; align-items: baseline; gap: 8px; margin: 0 0 12px; }
  .sg-figure b {
    font-family: "IBM Plex Mono", "Courier New", monospace;
    font-size: 32px; font-weight: 600; line-height: 1; color: var(--sg-ink);
  }
  .sg-figure span { font-size: 13px; color: var(--sg-muted); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 0; border-top: 1px solid var(--sg-hairline); }
  th { width: 36%; font-weight: 400; color: var(--sg-muted); }
  td { color: var(--sg-body); }
  .sg-note {
    margin-top: 12px; padding: 8px 10px; background: var(--sg-raised);
    border-radius: 6px; font-size: 11px; color: var(--sg-muted);
  }
`;
}
