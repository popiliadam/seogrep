import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { blogSource, source } from "../lib/source";

type Entry = MetadataRoute.Sitemap[number];

const ROUTES = ["", "/pricing", "/how-it-works", "/docs", "/blog", "/terms", "/privacy"] as const;

/**
 * Every indexable URL, not just the hand-listed routes: docs and blog pages come from the
 * content collections, so the sitemap cannot drift away from what actually ships.
 * `lastModified` is set only where a real date exists (post frontmatter) — docs pages carry
 * no trustworthy timestamp, and a made-up one is worse than none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const entries: Entry[] = [
    ...ROUTES.map((route) => ({ url: route })),
    ...source.getPages().map((page) => ({ url: page.url })),
    ...blogSource.getPages().map((post) => ({ url: post.url, lastModified: post.data.date })),
  ];

  const unique = new Map<string, Entry>();
  for (const entry of entries) {
    if (!unique.has(entry.url)) unique.set(entry.url, entry);
  }

  return [...unique.values()].map((entry) => ({ ...entry, url: `${SITE_URL}${entry.url}` }));
}
