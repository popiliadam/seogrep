import { describe, expect, it } from "vitest";
import { computeIssues, normalizeUrl, parseHtml } from "./crawl.ts";

const BASE = "https://site.test/blog/post";

// --- Pure parsing / normalization units (no network) ---------------------------

describe("parseHtml", () => {
  const html = `<!doctype html>
    <html>
      <head>
        <title>  Hello &amp; World  </title>
        <meta name="description" content="A &quot;great&quot; page">
        <meta name="robots" content="index,follow">
        <link rel="canonical" href="/blog/post">
        <script>var x = "<h1>not a heading</h1>";</script>
      </head>
      <body>
        <h1>Main Heading</h1>
        <p>One two three four five.</p>
        <a href="/about">About</a>
        <a href="about">About dup path</a>
        <a href="https://other.test/x">External</a>
        <a href="mailto:hi@site.test">Mail</a>
        <a href="#top">Anchor</a>
      </body>
    </html>`;

  const parsed = parseHtml(html, BASE);

  it("extracts and entity-decodes the title", () => {
    expect(parsed.title).toBe("Hello & World");
  });

  it("extracts the meta description and robots meta", () => {
    expect(parsed.metaDescription).toBe('A "great" page');
    expect(parsed.robotsMeta).toBe("index,follow");
  });

  it("resolves the canonical against the base URL", () => {
    expect(parsed.canonical).toBe("https://site.test/blog/post");
  });

  it("collects non-empty h1 text and ignores headings inside <script>", () => {
    expect(parsed.h1s).toEqual(["Main Heading"]);
  });

  it("resolves links to absolute URLs, dedupes, and drops mailto/#fragment-only", () => {
    expect(parsed.links).toEqual([
      "https://site.test/about",
      "https://site.test/blog/about",
      "https://other.test/x",
      "https://site.test/blog/post",
    ]);
  });

  it("counts only visible words, excluding script/style bodies", () => {
    const wc = parseHtml(
      "<body><p>alpha beta gamma</p><style>x{color:red}</style>" +
        "<script>one two three four five six seven</script></body>",
      BASE,
    ).wordCount;
    expect(wc).toBe(3); // script/style tokens are not counted
  });

  it("returns nulls when head elements are absent", () => {
    const bare = parseHtml("<html><body><p>hi</p></body></html>", BASE);
    expect(bare.title).toBeNull();
    expect(bare.metaDescription).toBeNull();
    expect(bare.canonical).toBeNull();
    expect(bare.robotsMeta).toBeNull();
    expect(bare.h1s).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it("drops the fragment", () => {
    expect(normalizeUrl("https://site.test/a#section")).toBe("https://site.test/a");
  });

  it("drops a trailing slash except on root, and keeps the query", () => {
    expect(normalizeUrl("https://site.test/a/")).toBe("https://site.test/a");
    expect(normalizeUrl("https://site.test/")).toBe("https://site.test/");
    expect(normalizeUrl("https://site.test/a/?q=1")).toBe("https://site.test/a?q=1");
  });

  it("lower-cases the host but preserves path case", () => {
    expect(normalizeUrl("https://Site.TEST/Path")).toBe("https://site.test/Path");
  });
});

describe("computeIssues", () => {
  it("flags missing title / description, multiple h1, and noindex", () => {
    expect(
      computeIssues({ title: null, metaDescription: null, h1s: ["a", "b"], robotsMeta: "noindex" }),
    ).toEqual(["missing title", "missing meta description", "multiple h1", "noindex"]);
  });

  it("returns no issues for a clean page", () => {
    expect(
      computeIssues({ title: "T", metaDescription: "D", h1s: ["only one"], robotsMeta: "index" }),
    ).toEqual([]);
  });
});
