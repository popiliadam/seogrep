import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/site";
import "./globals.css";

// Static 400/500 subsets, NOT the variable font with the opsz axis: the variable files were
// 147KB + 132KB and their ~4s arrival on throttled mobile re-emitted the LCP entry for every
// hero paragraph at font-swap time (Lighthouse gate measured LCP 4.1s, render-delay 89%).
// The optical-sizing axis is the fidelity cost; the pages set explicit sizes throughout.
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
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

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
    <html lang="en" suppressHydrationWarning className={`${newsreader.variable} ${plexMono.variable}`}>
      {/* RootProvider is NOT here on purpose: it is a fumadocs client provider (search dialog +
          sidebar state) that only /docs consumes, and mounting it at the root put its client
          chunk on every marketing, auth and app page. It now lives in app/docs/layout.tsx. */}
      <body>{children}</body>
    </html>
  );
}
