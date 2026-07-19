/**
 * Local node:http fixture site for the crawler specs. Binds to 127.0.0.1 on an
 * ephemeral port and serves a small, deterministic site exercising every crawl
 * behavior: robots.txt, sitemap (toggleable), a redirect, a redirect loop, an
 * off-origin link, a non-HTML resource, a slow endpoint, and a robots-disallowed
 * path. It records every requested path so specs can assert what was (never) fetched.
 *
 * This is test infrastructure — it makes ZERO outbound network requests; the crawler
 * talks to it over loopback only.
 */

import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ABOUT_HTML,
  BLOG_HTML,
  INDEX_HTML,
  NOINDEX_HTML,
  NOT_FOUND_HTML,
  ORPHAN_HTML,
  PRIVATE_HTML,
  ROBOTS_TXT,
  WEIRD_ENTITY_HTML,
} from "./pages.ts";

export interface FixtureOptions {
  /** Serve /sitemap.xml (default true). When false it 404s, forcing link-following BFS. */
  sitemap?: boolean;
  /**
   * When set, /sitemap.xml serves a <sitemapindex> with exactly these <loc>s
   * (relative values are resolved against this server's origin). The same-origin
   * child lives at /sitemap-child.xml and seeds /orphan.
   */
  sitemapIndex?: string[];
  /** Delay before /slow responds, ms (default 1000) — used to trigger page timeouts. */
  slowMs?: number;
}

export interface FixtureSite {
  /** Ephemeral origin, e.g. http://127.0.0.1:54321. */
  readonly origin: string;
  /** Pathnames the server received, in order (query/fragment stripped). */
  readonly requested: string[];
  close(): Promise<void>;
}

/** Static HTML pages served with a 200 text/html response. */
const HTML_ROUTES: Record<string, string> = {
  "/": INDEX_HTML,
  "/about": ABOUT_HTML,
  "/blog": BLOG_HTML,
  "/noindex": NOINDEX_HTML,
  "/orphan": ORPHAN_HTML,
  "/private": PRIVATE_HTML,
  "/weird": WEIRD_ENTITY_HTML,
};

/** Paths advertised in the generated sitemap (absolute locs built per-request). */
const SITEMAP_PATHS = ["/", "/about", "/blog", "/noindex", "/orphan"];

function sendHtml(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

export function startFixtureSite(options: FixtureOptions = {}): Promise<FixtureSite> {
  const sitemapEnabled = options.sitemap ?? true;
  const slowMs = options.slowMs ?? 1000;
  const requested: string[] = [];

  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const path = new URL(req.url ?? "/", origin).pathname;
    requested.push(path);

    const staticBody = HTML_ROUTES[path];
    if (staticBody !== undefined) {
      sendHtml(res, staticBody);
      return;
    }

    if (path === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(ROBOTS_TXT);
    } else if (path === "/sitemap.xml") {
      if (!sitemapEnabled) {
        sendHtml(res, NOT_FOUND_HTML, 404);
        return;
      }
      res.writeHead(200, { "content-type": "application/xml" });
      if (options.sitemapIndex) {
        const locs = options.sitemapIndex
          .map((loc) => `<sitemap><loc>${new URL(loc, origin).toString()}</loc></sitemap>`)
          .join("");
        res.end(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex>${locs}</sitemapindex>`);
        return;
      }
      const urls = SITEMAP_PATHS.map((p) => `<url><loc>${origin}${p}</loc></url>`).join("");
      res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset>${urls}</urlset>`);
    } else if (path === "/sitemap-child.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>${origin}/orphan</loc></url></urlset>`);
    } else if (path === "/redirect") {
      res.writeHead(302, { location: "/about" });
      res.end();
    } else if (path === "/redirect-loop") {
      res.writeHead(302, { location: "/redirect-loop" });
      res.end();
    } else if (path === "/image.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } else if (path === "/slow") {
      const timer = setTimeout(() => {
        if (!res.writableEnded) sendHtml(res, "<html><body><h1>Slow</h1></body></html>");
      }, slowMs);
      res.on("close", () => clearTimeout(timer));
    } else {
      sendHtml(res, NOT_FOUND_HTML, 404);
    }
  });

  return new Promise<FixtureSite>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requested,
        close: () =>
          new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}
