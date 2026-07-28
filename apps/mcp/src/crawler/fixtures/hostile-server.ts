/**
 * Hostile-RESPONSE fixture site for the crawler's size limits (H-02). Binds 127.0.0.1 on an
 * ephemeral port and serves deliberately abusive — but entirely legal — responses:
 *
 *  - /bomb     a gzip bomb: kilobytes on the wire, megabytes once inflated, with an honest
 *              Content-Length that describes the WIRE size and therefore lies about memory;
 *  - /chunked  a body streamed with NO Content-Length at all (chunked transfer), so nothing
 *              in the headers can bound it;
 *  - /links    a page carrying an absurd number of unique same-origin links;
 *  - /p/<id>   the link targets — each is itself link-rich, so BFS discovery keeps growing;
 *  - /heavy, /h/<id>  the same link flood with LONG (but legal) paths, so each page is a
 *              legitimately large RECORD rather than merely a large body — the shape that
 *              multiplies the per-record ceilings into a huge jobs.result (T8);
 *  - /sitemap.xml a <urlset> with an absurd number of <loc>s (opt-in via `locCount`).
 *
 * Test infrastructure only: it makes ZERO outbound requests; the crawler reaches it over
 * loopback. `bytesWritten` records what the server actually managed to push per path, so a
 * spec can prove the crawler CANCELLED a hostile body instead of draining it.
 */

import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

export interface HostileOptions {
  /** Size /bomb inflates to, bytes (default 20 MB; ~20 KB on the wire). */
  bombBytes?: number;
  /** Size /chunked streams with no Content-Length, bytes (default 30 MB). */
  chunkedBytes?: number;
  /** Unique same-origin links every /links and /p/<id> page carries (default 2000). */
  linkCount?: number;
  /**
   * Filler characters padded into every /h/ link path (default 1400 — under the crawler's
   * 2000-char field ceiling, so the links are RECORDED rather than dropped). This is what
   * makes each /heavy page a ~linkCount x 1400-char record.
   */
  heavyLinkChars?: number;
  /** <loc> entries /sitemap.xml carries; 0 (the default) serves 404 so BFS is used. */
  locCount?: number;
}

export interface HostileSite {
  /** Ephemeral origin, e.g. http://127.0.0.1:54321. */
  readonly origin: string;
  /** Pathnames the server received, in order. */
  readonly requested: string[];
  /** Response bytes actually pushed, per path — proof a cancelled body stopped early. */
  readonly bytesWritten: Map<string, number>;
  close(): Promise<void>;
}

const HTML_HEAD = "<html><head><title>Hostile</title></head><body>";
const HTML_TAIL = "</body></html>";

/** An HTML page with `count` unique same-origin links below `prefix`. */
function linkPage(prefix: string, count: number): string {
  const anchors: string[] = [];
  for (let i = 0; i < count; i++) anchors.push(`<a href="${prefix}${i}">l</a>`);
  return `${HTML_HEAD}<h1>Links</h1>${anchors.join("")}${HTML_TAIL}`;
}

/**
 * A page with `count` links under a FIXED /h/ prefix whose paths are padded to `padChars`.
 * The prefix is fixed (not derived from the requesting path) on purpose: every /h/ page then
 * emits the SAME link set, so BFS finds `count` distinct pages that are each individually
 * legal and individually within every per-record ceiling — and collectively enormous.
 */
function heavyLinkPage(count: number, padChars: number): string {
  const pad = "h".repeat(padChars);
  const anchors: string[] = [];
  for (let i = 0; i < count; i++) anchors.push(`<a href="/h/${pad}${i}">l</a>`);
  return `${HTML_HEAD}<h1>Heavy</h1>${anchors.join("")}${HTML_TAIL}`;
}

/** A <urlset> with `count` same-origin <loc>s. */
function sitemapXml(origin: string, count: number): string {
  const locs: string[] = [];
  for (let i = 0; i < count; i++) locs.push(`<url><loc>${origin}/p/s${i}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${locs.join("")}</urlset>`;
}

/**
 * Write `body` in 64 KiB slices with NO Content-Length, honouring backpressure and stopping
 * the moment the client goes away. That last part is what makes `bytesWritten` meaningful:
 * a crawler that cancels at its ceiling leaves this pump far short of the full body.
 */
function streamBody(res: ServerResponse, body: Buffer, onWrite: (n: number) => void): void {
  let closed = false;
  let sent = 0;
  res.on("close", () => {
    closed = true;
  });
  const pump = (): void => {
    while (!closed && sent < body.length) {
      const end = Math.min(sent + 64 * 1024, body.length);
      const slice = body.subarray(sent, end);
      onWrite(end - sent);
      sent = end;
      if (!res.write(slice)) {
        res.once("drain", pump);
        return;
      }
    }
    if (!closed) res.end();
  };
  pump();
}

export function startHostileSite(options: HostileOptions = {}): Promise<HostileSite> {
  const bombBytes = options.bombBytes ?? 20_000_000;
  const chunkedBytes = options.chunkedBytes ?? 30_000_000;
  const linkCount = options.linkCount ?? 2_000;
  const heavyLinkChars = options.heavyLinkChars ?? 1_400;
  const locCount = options.locCount ?? 0;
  const requested: string[] = [];
  const bytesWritten = new Map<string, number>();
  const record = (path: string) => (n: number) => {
    bytesWritten.set(path, (bytesWritten.get(path) ?? 0) + n);
  };

  // Built lazily and cached: a 20 MB buffer / a 2000-link page is not worth rebuilding per
  // request, and each spec exercises at most one of these routes.
  let bomb: Buffer | undefined;
  let sitemap: Buffer | undefined;
  let filler: Buffer | undefined;
  const pages = new Map<string, Buffer>();

  const server = createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const path = new URL(req.url ?? "/", origin).pathname;
    requested.push(path);
    const wrote = record(path);

    if (path === "/robots.txt") {
      const body = "User-agent: *\nAllow: /\n";
      res.writeHead(200, { "content-type": "text/plain" });
      wrote(body.length);
      res.end(body);
      return;
    }
    if (path === "/sitemap.xml") {
      if (locCount === 0) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("no sitemap");
        return;
      }
      sitemap ??= Buffer.from(sitemapXml(origin, locCount));
      res.writeHead(200, { "content-type": "application/xml" });
      streamBody(res, sitemap, wrote);
      return;
    }
    if (path === "/bomb") {
      // Content-Length is the WIRE size — truthful HTTP, and useless as a memory bound.
      bomb ??= gzipSync(
        Buffer.concat([
          Buffer.from(HTML_HEAD),
          Buffer.alloc(bombBytes, 0x61),
          Buffer.from(HTML_TAIL),
        ]),
      );
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "gzip",
        "content-length": String(bomb.length),
      });
      wrote(bomb.length);
      res.end(bomb);
      return;
    }
    if (path === "/chunked") {
      filler ??= Buffer.concat([Buffer.from(HTML_HEAD), Buffer.alloc(chunkedBytes, 0x61)]);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); // no content-length
      streamBody(res, filler, wrote);
      return;
    }
    if (path === "/heavy" || path.startsWith("/h/")) {
      // ONE cached body: every /h/ page is byte-identical (fixed prefix), so this costs
      // one build no matter how many the crawler walks.
      let body = pages.get("/heavy");
      if (body === undefined) {
        body = Buffer.from(heavyLinkPage(linkCount, heavyLinkChars));
        pages.set("/heavy", body);
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      wrote(body.length);
      res.end(body);
      return;
    }
    if (path === "/links" || path.startsWith("/p/")) {
      let body = pages.get(path);
      if (body === undefined) {
        body = Buffer.from(linkPage(path === "/links" ? "/p/a" : `${path}.`, linkCount));
        pages.set(path, body);
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      wrote(body.length);
      res.end(body);
      return;
    }
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body>not found</body></html>");
  });

  return new Promise<HostileSite>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requested,
        bytesWritten,
        close: () =>
          new Promise<void>((ok, fail) => server.close((err) => (err ? fail(err) : ok()))),
      });
    });
  });
}
