import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/site";
import "./globals.css";

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
  },
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
