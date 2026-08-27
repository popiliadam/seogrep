/**
 * The card's two palettes, COPIED from apps/web/app/globals.css.
 *
 * A copy, and said out loud: apps/mcp may not depend on apps/web, and @pseo/core is the package
 * whose single runtime dependency is zod — a palette does not belong there. A rebrand therefore
 * touches two files. That is a deliberate debt, recorded in the spec (§11), and `palette.test.ts`
 * pins the values so the debt is visible rather than silent.
 *
 * LIGHT is a direct, verified copy: every hex below matches a `--color-*` token in globals.css
 * (surface/raised/ink/body/muted/hairline from `--color-card`, `--color-band`, `--color-ink`,
 * `--color-body`, `--color-muted`, `--color-hairline`; accent/accentSurface/accentEdge from
 * `--color-accent`, `--color-accent-badge-bg`, `--color-accent-badge-border`).
 *
 * DARK is only PARTIALLY grounded in that file, and that gap is recorded rather than papered
 * over (task-2-report.md carries the full per-key trace):
 *   - surface, raised, accent, muted and body DO match existing dark-surface tokens
 *     (`--color-terminal`, `--color-terminal-chrome`, `--color-accent-dark`, `--color-faint`,
 *     `--color-faintest`).
 *   - ink, hairline, accentSurface and accentEdge do NOT match anything in globals.css today.
 *     The file's own dark text token is `--color-dark-text: #f0ece2`, not the `#faf8f3` used
 *     below; and it defines no dark accent-surface/accent-edge pair and no solid dark hairline
 *     (only `--color-hairline-dark: rgb(250 248 243 / 0.08)`, a translucent white). These four
 *     values are reproduced EXACTLY as the task brief specified them, verbatim and unedited —
 *     not silently "corrected" to the site's tokens, because deciding which is right is a design
 *     call this task was told not to make on its own.
 */
export interface Palette {
  readonly surface: string;
  readonly raised: string;
  readonly ink: string;
  readonly body: string;
  readonly muted: string;
  readonly hairline: string;
  readonly accent: string;
  readonly accentSurface: string;
  readonly accentEdge: string;
}

export const LIGHT: Palette = {
  surface: "#fffdf9",
  raised: "#f5f2ea",
  ink: "#1c1b18",
  body: "#524f48",
  muted: "#6b6862",
  hairline: "#e2ddd2",
  accent: "#b45309",
  accentSurface: "#f9f0dd",
  accentEdge: "#ecd9b8",
};

export const DARK: Palette = {
  surface: "#211f1b",
  raised: "#262420",
  ink: "#faf8f3",
  body: "#c4beb0",
  muted: "#a8a294",
  hairline: "#3a3730",
  accent: "#d9a353",
  accentSurface: "#33302a",
  accentEdge: "#4a4335",
};
