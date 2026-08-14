import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import type { ReactNode } from "react";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/site";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-newsreader",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
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
      <body>
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
