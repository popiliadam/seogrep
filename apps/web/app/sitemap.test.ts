import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "../lib/site";

// The MDX collections cannot be compiled inside vitest (no fumadocs bundler plugin here),
// so the loaders are stubbed with the shape `loader()` really returns: `{ url, data }`.
const DOC_PAGES = [
  { url: "/docs" },
  { url: "/docs/faq" },
  { url: "/docs/getting-started/claude-code" },
  { url: "/docs/tools-reference/crawl-site" },
];
const BLOG_PAGES = [
  { url: "/blog/first-post", data: { date: "2026-07-20" } },
  { url: "/blog/second-post", data: { date: "2026-07-24" } },
];

vi.mock("../lib/source", () => ({
  source: { getPages: () => DOC_PAGES },
  blogSource: { getPages: () => BLOG_PAGES },
}));

import sitemap from "./sitemap";

const STATIC_ROUTES = ["", "/pricing", "/how-it-works", "/docs", "/terms", "/privacy", "/refunds"] as const;

describe("sitemap", () => {
  it("still lists every static marketing route", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const route of STATIC_ROUTES) {
      expect(urls, `missing ${route || "/"}`).toContain(`${SITE_URL}${route}`);
    }
  });

  it("lists the refund policy exactly once, absolute (Paddle requires it published and linked)", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.filter((url) => url === `${SITE_URL}/refunds`)).toHaveLength(1);
  });

  it("lists the blog index too", () => {
    expect(sitemap().map((entry) => entry.url)).toContain(`${SITE_URL}/blog`);
  });

  it("enumerates the docs pages instead of just the /docs root", () => {
    const urls = sitemap().map((entry) => entry.url);
    const docPages = urls.filter((url) => url.startsWith(`${SITE_URL}/docs/`));
    expect(docPages.length).toBeGreaterThan(0);
    expect(urls.length).toBeGreaterThan(STATIC_ROUTES.length);
  });

  it("enumerates every blog post", () => {
    const urls = sitemap().map((entry) => entry.url);
    for (const post of BLOG_PAGES) {
      expect(urls).toContain(`${SITE_URL}${post.url}`);
    }
  });

  it("emits absolute URLs on the canonical host only", () => {
    for (const entry of sitemap()) {
      expect(entry.url.startsWith(`${SITE_URL}/`) || entry.url === SITE_URL, entry.url).toBe(true);
    }
  });

  it("carries no duplicate URL, even though /docs is both a static route and a page", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.filter((url) => url === `${SITE_URL}/docs`)).toHaveLength(1);
  });

  it("dates posts from their frontmatter and invents no date for anything else", () => {
    const entries = sitemap();
    const post = entries.find((entry) => entry.url === `${SITE_URL}/blog/first-post`);
    expect(post?.lastModified).toBe("2026-07-20");
    const withDates = entries.filter((entry) => entry.lastModified !== undefined);
    expect(withDates.map((entry) => entry.url)).toEqual([
      `${SITE_URL}/blog/first-post`,
      `${SITE_URL}/blog/second-post`,
    ]);
  });
});
