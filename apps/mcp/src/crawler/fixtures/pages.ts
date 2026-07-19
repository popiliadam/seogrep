/**
 * Static HTML + robots.txt bodies for the crawler's local fixture site. The sitemap
 * and redirect responses are generated dynamically by site-server.ts (they need the
 * server's ephemeral origin), so they are not here. Hrefs are relative and resolved
 * against each page URL by the crawler. No content here reaches the public network.
 */

export const ROBOTS_TXT = ["User-agent: *", "Disallow: /private", ""].join("\n");

export const INDEX_HTML = `<!doctype html><html><head>
<title>SeoGrep Fixture — Home</title>
<meta name="description" content="Fixture home page for crawler tests.">
<link rel="canonical" href="/">
</head><body>
<h1>Home</h1>
<p>Welcome to the fixture site used by crawler tests.</p>
<nav>
  <a href="/about">About</a>
  <a href="/about/">About with trailing slash</a>
  <a href="/about#team">About with fragment</a>
  <a href="/blog">Blog</a>
  <a href="/noindex">Noindex</a>
  <a href="/private">Private (robots-disallowed)</a>
  <a href="/redirect">Redirected</a>
  <a href="/image.png">An image</a>
  <a href="http://external.invalid/page">External (off-origin)</a>
</nav>
</body></html>`;

export const ABOUT_HTML = `<!doctype html><html><head>
<title>About — Fixture</title>
<meta name="description" content="About the fixture site.">
</head><body>
<h1>About</h1>
<p>A short about page.</p>
<a href="/">Home</a>
</body></html>`;

// Intentionally two <h1> and no meta description -> exercises the issue flags.
export const BLOG_HTML = `<!doctype html><html><head>
<title>Blog — Fixture</title>
</head><body>
<h1>Blog</h1>
<h1>Second Heading</h1>
<p>Some blog body text.</p>
<a href="/about">About</a>
</body></html>`;

export const NOINDEX_HTML = `<!doctype html><html><head>
<title>Noindex — Fixture</title>
<meta name="description" content="This page opts out of indexing.">
<meta name="robots" content="noindex,follow">
</head><body>
<h1>Noindex</h1>
<p>Should be flagged as noindex.</p>
</body></html>`;

// Served with 200 but robots.txt disallows it; a compliant crawler never fetches it.
export const PRIVATE_HTML = `<!doctype html><html><head>
<title>Private — Fixture</title>
<meta name="description" content="Private area.">
</head><body>
<h1>Private</h1>
<p>This page must never be fetched by the crawler.</p>
</body></html>`;

// Reachable only via the sitemap (no page links to it) -> proves sitemap seeding.
export const ORPHAN_HTML = `<!doctype html><html><head>
<title>Orphan — Fixture</title>
<meta name="description" content="Reachable only through the sitemap.">
</head><body>
<h1>Orphan</h1>
<p>Seeded from the sitemap only.</p>
</body></html>`;

export const NOT_FOUND_HTML = `<!doctype html><html><head>
<title>404 — Fixture</title>
</head><body><h1>Not Found</h1></body></html>`;
