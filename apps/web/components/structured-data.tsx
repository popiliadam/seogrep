import { SITE_NAME, SITE_URL } from "../lib/site";

// JSON-LD structured data (audit G2: 0/42 pages carried any). Every object is a STATIC literal built
// from our own site constants — no user input — so there is no injection surface; we still escape `<`
// to `<` (the standard defence) so a value can never break out of the <script> element.
function jsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const ORGANIZATION = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon.svg`,
} as const;

const WEBSITE = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
} as const;

const SOFTWARE_APPLICATION = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web-based (MCP client)",
  description:
    "Run SEO crawls, audits, quick-win discovery, and Search Console analysis in plain language " +
    "inside your AI assistant, via one personal MCP URL.",
} as const;

/** Organization + WebSite identity — render once per page across the public marketing site. */
export function SiteStructuredData() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ORGANIZATION) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(WEBSITE) }} />
    </>
  );
}

/** SoftwareApplication schema for the product — render on the landing page only. */
export function SoftwareApplicationStructuredData() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(SOFTWARE_APPLICATION) }} />;
}
