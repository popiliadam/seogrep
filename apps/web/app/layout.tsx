import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/site";
import "./globals.css";

// WHY THE FACES ARE SPLIT ACROSS THREE CALLS — measured, not stylistic.
//
// Lighthouse's gate runs Lantern (simulated) throttling at ~200 KB/s. Its pessimistic FCP and
// LCP graphs contain every request that started before the observed paint, and on localhost that
// is the WHOLE initial payload — so simulated FCP and LCP both track total initial bytes at a
// measured ~100 ms per 20 KB. /pricing was 288 ms behind / on FCP for exactly the 65 KB of extra
// font it pulled. Font bytes are therefore the gate's dominant lever, and `preload`/`display`
// are not: neither moves a byte.
//
// Google Fonts serves a VARIABLE file whenever a family is asked for more than one weight, and a
// static instance when asked for exactly one (latin subset, measured against the CSS2 API):
//   Newsreader wght@400;500 -> 58.2 KB variable   | wght@400 -> 22.5 KB static
//   Newsreader ital wght@1,400;1,500 -> 64.5 KB   | ital wght@1,400 -> 24.4 KB static
// The roman face genuinely needs 400 AND 500 (body vs. headings), so it stays variable. The
// italic face is used at ONE weight in exactly two places (the blog post standfirst and the
// credit-cost table caption), so asking for both weights bought a 40 KB variable file to render
// a single line of 400-weight text.
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  // Roman only. Italic moved to its own single-weight call below; leaving it here is what made
  // Google hand back the 64.5 KB variable italic.
  style: "normal",
  variable: "--font-newsreader",
  display: "swap",
  // preload:false takes the font files OFF the LCP critical path. The Lighthouse gate uses
  // simulated (Lantern) throttling, which models PRELOADED fonts as LCP dependencies — with
  // preload on, every hero paragraph's simulated LCP tracked font bytes linearly (310KB → 4.1s,
  // 155KB → 3.4s) whatever `display` said. Off the preload list, text renders with the
  // size-adjusted fallback and swaps when the font lands (a beat later than preload on fast
  // connections — the accepted trade for a deterministic gate).
  preload: false,
});

// Same typeface, same weight, same optical design as before — only the file is now the 24.4 KB
// static instance instead of a 64.5 KB variable one. Reached through `font-serif-italic`, since
// a separate next/font call is a separate CSS family name and cannot be weight-matched into the
// roman family.
const newsreaderItalic = Newsreader({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-newsreader-italic",
  display: "swap",
  preload: false,
});

// The 500 italic, as its own static instance. Bold text inside italic prose (a `**lead-in**`
// inside a blockquote) asks for 700; with the old variable italic the browser matched that down
// to the 500 face and synthesised the rest, and dropping to a 400-only family made those lead-ins
// visibly lighter — the one real rendering difference the screenshot diff caught. Because a font
// file is only fetched when some rendered text matches it, this face costs ZERO bytes on the
// three gated pages (none of them contain bold italic) and still halves what /docs and a blog
// post pay for it.
const newsreaderItalicStrong = Newsreader({
  subsets: ["latin"],
  weight: "500",
  style: "italic",
  variable: "--font-newsreader-italic-strong",
  display: "swap",
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  // 500 is declared by nothing: no `font-mono` element in the app resolves to weight 500, and
  // the gate's traces confirm the browser never requested that face. Its @font-face blocks were
  // dead bytes in the render-blocking font stylesheet.
  weight: ["400", "600"],
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} — SEO analysis inside your AI assistant`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  // Self-referencing canonical: Next resolves the relative "./" against metadataBase + the current
  // route, so every page inherits a canonical pointing at its own absolute URL (audit G2: 42/42
  // pages were canonical-less). Pages that don't override `alternates` keep this default.
  alternates: { canonical: "./" },
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    // Per-route, for the same reason and by the same mechanism as the canonical above: a static
    // SITE_URL here was inherited verbatim by every page, so ~40 docs pages, both blog posts and
    // every marketing page advertised the HOMEPAGE as their og:url while their canonical was
    // correct (audit L-19b). Shares of /pricing resolved to /. "./" is resolved against
    // metadataBase + the current route, so each page now declares its own URL.
    url: "./",
    // Default social card (1200×630 manpage frame); resolved against metadataBase. Pages that
    // declare their own openGraph.images still override this.
    images: ["/og.png"],
  },
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${newsreader.variable} ${newsreaderItalic.variable} ${newsreaderItalicStrong.variable} ${plexMono.variable}`}
    >
      {/* RootProvider is NOT here on purpose: it is a fumadocs client provider (search dialog +
          sidebar state) that only /docs consumes, and mounting it at the root put its client
          chunk on the critical path of every marketing page. It now lives in app/docs/layout.tsx. */}
      <body>{children}</body>
    </html>
  );
}
