import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  crawlSite,
  MAX_JSONLD_BLOCKS_PER_PAGE,
  MAX_JSONLD_BLOCK_CHARS,
  normalizeUrl,
  parseHtml,
  parseJsonLdBlocks,
  parseJsonLdTypes,
  type CrawlResult,
} from "./crawl.ts";
import { startFixtureSite, type FixtureSite } from "./fixtures/site-server.ts";

/**
 * THE JSON-LD BODIES (Faz 3a). `jsonLdTypes` could say a Product exists; only the body can say
 * whether it declares an offer — so the crawler now keeps the bodies, under two hard ceilings.
 *
 * Both ceilings are asserted at their BOUNDARY and pinned to their literal, for the reason
 * tech-signals.test.ts states: a spec that only fed an obviously-huge page would pass with the
 * cap set to 500 just as happily as with 5, and the number in the constant would be prose.
 */

const BASE = "https://site.test/page";
const block = (json: string): string =>
  `<script type="application/ld+json">${json}</script>`;

describe("parseJsonLdBlocks", () => {
  it("POSITIVE: keeps each body RAW (trimmed), in document order", () => {
    const html = `${block('{"@type":"Product","name":"A"}')}${block('\n  {"@type":"Organization"}\n')}`;
    expect(parseJsonLdBlocks(html)).toEqual({
      blocks: ['{"@type":"Product","name":"A"}', '{"@type":"Organization"}'],
      truncated: 0,
    });
  });

  it("POSITIVE: a MALFORMED body is stored, not swallowed", () => {
    // The type reader skips it silently (a bad block must never kill a crawl); the audit is the
    // layer that reports it. That only works if the body survives the crawler.
    const html = block("{ this is not valid json }");
    expect(parseJsonLdBlocks(html).blocks).toEqual(["{ this is not valid json }"]);
    expect(parseJsonLdTypes(html)).toEqual([]);
  });

  it("NEGATIVE: a page with no JSON-LD (and one with an empty block) yields nothing", () => {
    expect(parseJsonLdBlocks("<html><body><p>hi</p></body></html>")).toEqual({
      blocks: [],
      truncated: 0,
    });
    // A blank block is not a block: it is neither stored nor counted as dropped.
    expect(parseJsonLdBlocks(block("   \n  "))).toEqual({ blocks: [], truncated: 0 });
    // A <script> of another type is not JSON-LD.
    expect(parseJsonLdBlocks('<script type="text/javascript">{"@type":"Product"}</script>')).toEqual({
      blocks: [],
      truncated: 0,
    });
  });

  it("BOUNDARY: five blocks are kept, the sixth and seventh are dropped and COUNTED", () => {
    const five = Array.from({ length: 5 }, (_, i) => block(`{"@type":"T${i}"}`)).join("");
    expect(parseJsonLdBlocks(five).blocks).toHaveLength(5);
    expect(parseJsonLdBlocks(five).truncated).toBe(0);

    const seven = Array.from({ length: 7 }, (_, i) => block(`{"@type":"T${i}"}`)).join("");
    const parsed = parseJsonLdBlocks(seven);
    expect(parsed.blocks).toHaveLength(5);
    expect(parsed.truncated).toBe(2);
    // The FIRST five are the ones kept — document order, not an arbitrary five.
    expect(parsed.blocks[0]).toBe('{"@type":"T0"}');
    expect(parsed.blocks[4]).toBe('{"@type":"T4"}');

    expect(MAX_JSONLD_BLOCKS_PER_PAGE).toBe(5);
  });

  it("BOUNDARY: a body of exactly 4000 chars is kept, 4001 is DROPPED WHOLE", () => {
    const bodyOf = (length: number): string => {
      const padding = "x".repeat(Math.max(0, length - '{"@type":"P","name":""}'.length));
      return `{"@type":"P","name":"${padding}"}`;
    };
    const exact = bodyOf(MAX_JSONLD_BLOCK_CHARS);
    expect(exact).toHaveLength(MAX_JSONLD_BLOCK_CHARS);
    expect(parseJsonLdBlocks(block(exact))).toEqual({ blocks: [exact], truncated: 0 });

    const over = bodyOf(MAX_JSONLD_BLOCK_CHARS + 1);
    expect(over).toHaveLength(MAX_JSONLD_BLOCK_CHARS + 1);
    const parsed = parseJsonLdBlocks(block(over));
    // DROPPED, never clamped: a JSON document cut mid-string would not parse, and the audit
    // would report an `invalid_json` defect the crawler itself manufactured.
    expect(parsed.blocks).toEqual([]);
    expect(parsed.truncated).toBe(1);

    expect(MAX_JSONLD_BLOCK_CHARS).toBe(4_000);
  });
});

describe("parseHtml carries the bodies onto the record", () => {
  it("attaches blocks and the dropped count alongside the unchanged type list", () => {
    const html = `<head>${block('{"@type":"Article","headline":"H"}')}</head><body>x</body>`;
    const parsed = parseHtml(html, BASE);
    expect(parsed.jsonLdBlocks).toEqual(['{"@type":"Article","headline":"H"}']);
    expect(parsed.jsonLdTruncated).toBe(0);
    // The pre-existing signal is untouched by the new one.
    expect(parsed.jsonLdTypes).toEqual(["Article"]);
  });

  it("a page with no structured data reports [] and 0, never undefined", () => {
    const parsed = parseHtml("<html><body><p>hi</p></body></html>", BASE);
    expect(parsed.jsonLdBlocks).toEqual([]);
    expect(parsed.jsonLdTruncated).toBe(0);
  });
});

describe("crawlSite stores the bodies it read (integration, loopback fixture)", () => {
  let site: FixtureSite;
  let result: CrawlResult;
  const at = (path: string): string => normalizeUrl(site.origin + path);

  beforeAll(async () => {
    site = await startFixtureSite();
    result = await crawlSite(site.origin, { crawlDelayCapMs: 0 });
  });
  afterAll(() => site.close());

  it("/blog keeps BOTH of its blocks — the Article and the malformed one", () => {
    const blog = result.pages.find((p) => p.url === at("/blog"));
    expect(blog?.jsonLdBlocks).toEqual([
      '{"@context":"https://schema.org","@type":"Article","headline":"Fixture Blog"}',
      "{ this is not valid json }",
    ]);
    expect(blog?.jsonLdTruncated).toBe(0);
    // …and the type list still reads exactly what it read before the bodies existed.
    expect(blog?.jsonLdTypes).toEqual(["Article"]);
  });

  it("a page with no JSON-LD carries an empty list, not a missing field", () => {
    const about = result.pages.find((p) => p.url === at("/about"));
    expect(about?.jsonLdBlocks).toEqual([]);
    expect(about?.jsonLdTruncated).toBe(0);
  });
});
