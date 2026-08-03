import { describe, expect, it } from "vitest";
import { SITE_URL } from "../lib/site";
import { metadata } from "./layout";

/**
 * Audit L-19b: `openGraph.url` was the absolute SITE_URL, and root metadata is INHERITED, so every
 * page that doesn't override it — ~40 docs pages, both blog posts, every marketing page — told
 * every scraper its og:url was the homepage. A share of /pricing resolved to /. The canonical was
 * already correct via the same relative-resolution trick, so the invariant pinned here is that the
 * two agree: og:url must resolve per-route exactly like the canonical does, never to a fixed URL.
 */
describe("root metadata — og:url", () => {
  const openGraph = metadata.openGraph as { url?: string | URL } | undefined;

  it("resolves per-route, exactly like the canonical", () => {
    const canonical = metadata.alternates?.canonical;
    expect(openGraph?.url, "og:url is set").toBeDefined();
    expect(String(openGraph?.url)).toBe(String(canonical));
  });

  it("is not a fixed absolute URL every page would inherit verbatim", () => {
    const url = String(openGraph?.url ?? "");
    expect(url, "og:url must not be the hardcoded site root").not.toBe(SITE_URL);
    expect(url, "og:url must be relative so metadataBase + route resolve it").not.toMatch(/^https?:\/\//);
  });

  it("still declares metadataBase, which is what resolves the relative url", () => {
    expect(String(metadata.metadataBase)).toContain(new URL(SITE_URL).host);
  });
});
