import { describe, expect, it } from "vitest";
import { metadata as login } from "./login/page";
import { metadata as signup } from "./signup/page";

/**
 * Audit L-19c: robots.ts disallows only /app, and neither auth page set `robots`, so /login and
 * /signup were fully indexable — and site-header.tsx links to /login from every page, so they were
 * well crawled. A sign-in form is not a search result anyone wants.
 *
 * noindex is set as page METADATA, deliberately not as a robots.txt Disallow: a disallowed path is
 * never fetched, so the crawler would never see the noindex and an already-indexed URL could sit in
 * the index indefinitely. follow: true, so the links out of these pages still carry.
 */
const AUTH_PAGES = [
  ["/login", login],
  ["/signup", signup],
] as const;

describe("auth page metadata", () => {
  it("keeps both auth pages out of the index", () => {
    for (const [route, meta] of AUTH_PAGES) {
      const robots = meta.robots as { index?: boolean; follow?: boolean } | undefined;
      expect(robots, `${route} sets robots`).toBeDefined();
      expect(robots?.index, `${route} must be noindex`).toBe(false);
    }
  });

  it("still lets crawlers follow the links out of them", () => {
    for (const [route, meta] of AUTH_PAGES) {
      const robots = meta.robots as { index?: boolean; follow?: boolean } | undefined;
      expect(robots?.follow, `${route} should stay follow`).toBe(true);
    }
  });

  it("keeps each page's own title", () => {
    for (const [route, meta] of AUTH_PAGES) {
      expect(typeof meta.title, `${route} title`).toBe("string");
      expect((meta.title as string).length, `${route} title empty`).toBeGreaterThan(0);
    }
  });
});
