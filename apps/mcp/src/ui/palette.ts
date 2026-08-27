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
 * DARK — corrected in fix round 1 (2026-08-27). globals.css DOES carry a full dark-surface
 * vocabulary (lines 58-64, "Dark (terminal / dark CTA) surface text"); the first pass of this
 * file simply never found it and reused three LIGHT-theme tokens on a dark surface instead — text
 * that is technically present and practically unreadable:
 *   - `ink` was `#faf8f3` (`--color-paper`, a LIGHT background) — now `#f0ece2`
 *     (`--color-dark-text`).
 *   - `body` was `#c4beb0` (`--color-faintest`, the LIGHT ink scale read backwards) — now
 *     `#918b7d` (`--color-dark-muted`).
 *   - `hairline` was `#3a3730`, a hex with no source anywhere in globals.css — now
 *     `rgb(250 248 243 / 0.08)` (`--color-hairline-dark`), the brand's own translucent-white
 *     dark hairline.
 * `surface`, `raised` and `accent` were already correct (`--color-terminal`,
 * `--color-terminal-chrome`, `--color-accent-dark`) and are unchanged.
 *
 * `muted` — corrected AGAIN in fix round 2 (2026-08-27). Round 1 mapped it to
 * `--color-dark-faint` (`#6e6a60`) by matching it to `--color-faint`, LIGHT's `muted` source —
 * but that is a naming coincidence, not a matching role: `--color-dark-faint` is a DECORATION
 * token in this brand, and measured contrast confirmed it — `#6e6a60` on `#211f1b` is 3.05:1,
 * below AA and below the 3:1 non-text floor. The brand's dark scale simply has FEWER readable
 * content tiers than its light scale: three in light (`ink`/`body`/`muted`, each its own token)
 * but only TWO in dark (`--color-dark-text`, `--color-dark-muted`) before the tokens stop being
 * body text. `muted` is therefore `#918b7d`, the SAME `--color-dark-muted` as `body` — accepting
 * that the brand does not have a third readable dark tier is honest; inventing one by treating a
 * decoration token as text would not have been. `--color-hairline-dark`'s `--color-dark-faint`
 * neighbour (`#6e6a60`) now maps to nothing in this palette, which is correct for a token this
 * brand uses for decoration, not text. `palette.test.ts` pins both the token match AND the actual
 * contrast ratio so this cannot silently regress again.
 *
 * `accentSurface` and `accentEdge` remain the one REAL gap: globals.css defines no dark
 * counterpart to `--color-accent-badge-bg` / `--color-accent-badge-border` at all. Rather than
 * invent a fifth hue, both are the brand's existing dark accent AT ALPHA —
 * `rgb(217 163 83 / …)`, where `217 163 83` is `--color-accent-dark` (`#d9a353`) in decimal. An
 * alpha of a brand colour that already exists is not a new colour; a new hex would have been.
 *
 * `palette.test.ts` now reads globals.css itself and asserts each of these against its named
 * token, so a future edit to either file that lets them diverge fails a test rather than shipping
 * quietly (finding 3, fix round 1).
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
  ink: "#f0ece2",
  body: "#918b7d",
  muted: "#918b7d",
  hairline: "rgb(250 248 243 / 0.08)",
  accent: "#d9a353",
  // Derived, not copied: --color-accent-dark (#d9a353 = rgb(217 163 83)) at alpha. See the doc
  // comment above — globals.css has no dark accent-surface/accent-edge pair to copy.
  accentSurface: "rgb(217 163 83 / 0.12)",
  accentEdge: "rgb(217 163 83 / 0.32)",
};
