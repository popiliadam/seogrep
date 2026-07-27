# Launch Post Drafts (Faz 4 — T-C1)

> Status: DRAFTS. The publish button is HUMAN-only (contract). No fabricated metrics,
> user counts, or testimonials anywhere (NEVER #7). Prices may be stated (human approves
> at publish time). Fields marked `[HUMAN]` are filled by the operator at publish.
> Honesty guards baked in: keyword research is OFF during beta (never advertise it as
> live); crawls are 100 pages per run; no traffic/ranking improvement claims (unmeasured).

---

## 1. Product Hunt

**Name:** SeoGrep

**Tagline (60 chars max):** `grep your site for SEO issues — from your AI agent`

**Description (260 chars max):**
SeoGrep is a hosted MCP server for SEO. Connect it to Claude, Cursor, or any MCP client
and ask it to crawl your site, audit on-page/technical/schema issues, pull Search Console
data, and generate shareable reports. Free trial, no card.

**Topics:** SEO · Developer Tools · Artificial Intelligence · Marketing

**First comment (maker story):**

Hi PH — maker here.

SeoGrep started from a simple observation: the place I actually *work* on my site is an
AI coding agent, not an SEO dashboard. So instead of another dashboard, SeoGrep is an MCP
server. You add one personal URL to Claude (or Cursor, Windsurf, any MCP client) and your
agent gets 16 SEO tools: crawl a site, run on-page / technical / structured-data audits,
pull your own Google Search Console data (quick wins, cannibalization, content decay),
and turn it all into a shareable report.

A few honest notes:
- It's a beta. The free trial is 200 credits, no card required.
- Crawls are capped at 100 pages per run today; bigger-site support is on the roadmap.
- We dogfood it: SeoGrep's own audits caught our missing canonicals and structured data
  before launch, and the fixes shipped because the report said so.

Ask me anything — happy to go deep on the MCP design, the credit ledger, or why the
crawler is deliberately polite about robots.txt.

`[HUMAN]`: screenshots/gallery (suggest: chat transcript of crawl→audit→report, /r/ report
page, pricing), launch date, hunter arrangement (self-hunt is fine).

---

## 2. Hacker News — Show HN

**Title (80 chars max):**
`Show HN: SeoGrep – an MCP server that lets your AI agent audit your site's SEO`

**URL:** https://seogrep.com

**Text:**

I built SeoGrep because my SEO workflow had moved into AI agents but the data hadn't.
It's a hosted MCP (Model Context Protocol) server: you sign up, get a personal MCP URL,
add it to Claude Code / Claude / Cursor / Windsurf, and your agent can crawl a site
(100 pages/run for now), run on-page, technical, and structured-data audits, pull your
own Search Console data via OAuth (quick-win queries, keyword cannibalization, content
decay), and generate a shareable HTML report.

Some implementation details HN might find interesting:

- Credits are an append-only ledger in Postgres; the balance is always derived as
  SUM(ledger) — there is no mutable balance column to drift. Reserve→commit/release
  around every paid tool call, enforced by DB constraints.
- The crawler is SSRF-hardened (post-DNS private-IP blocklist, redirect re-validation)
  because a hosted crawler is basically an SSRF machine if you're careless. It also
  refuses to crawl when robots.txt is unreachable, on purpose.
- Long work runs through a Postgres-backed job queue (pg-boss) — no Redis in the stack.
- Everything the agent sees is a typed tool with a zod schema; the docs tool reference
  is generated from the same schemas, so docs can't drift from reality.

It's a beta: no card for the trial (200 credits), paid plans exist, and keyword-volume
research is deliberately switched off until I'm happy with the cost controls. I'd love
feedback on the tool surface — what would you want an SEO agent to be able to do?

`[HUMAN — optional paragraph, publish-time decision]:` The product was built end-to-end
with an agent-orchestration process (planner/worker/referee model with deterministic
verification gates). Happy to answer questions about that too.

---

## 3. X/Twitter thread (5 posts)

**Post 1:**
Your AI agent can write code, but can it fix your SEO?

SeoGrep is a hosted MCP server: one URL in Claude/Cursor, and your agent can crawl your
site, audit it, read your Search Console data, and hand you a shareable report.

Free trial, no card → https://seogrep.com

**Post 2:**
The workflow, end to end, in chat:

"set up my site" → "crawl it" → "audit on-page + schema" → "what should I fix first?"
→ "make me a report I can send"

16 tools. One MCP URL. No dashboard tab-switching.

**Post 3:**
We dogfood it. Before launch, SeoGrep's own audit caught our site missing canonicals on
every page and shipping zero structured data. The fixes went out because our own report
flagged them. An SEO tool should survive being pointed at itself.

**Post 4:**
Under the hood, for the technically curious:
- credits = append-only Postgres ledger (balance is always SUM, never a mutable column)
- SSRF-hardened polite crawler
- every tool is a typed schema; docs are generated from the same schemas

**Post 5:**
Beta pricing: free trial (200 credits, no card), then $19/$49/$149 a month, top-ups if
you run dry. Works with Claude, Claude Code, Cursor, Windsurf — anything that speaks MCP.

Start here → https://seogrep.com

`[HUMAN]`: post timing/spacing, whether to attach a screen recording (suggest: 30s
crawl→report chat capture), pin decision.

---

## Publish checklist (HUMAN)

- [ ] Prices in post 5 / PH comment still match live pricing (NEVER #6 session outcome).
- [ ] If T-S1 (DNS-rebinding fix) has shipped by publish time, chief may add
      "resolved-IP pinning" to the Show HN SSRF list — never before it ships.
- [ ] research_keywords still off? (Drafts already avoid claiming it — if it gets enabled
      before launch, chief updates drafts to include it honestly.)
- [ ] Optional agent-orchestration paragraph in Show HN: include or drop.
- [ ] Screenshots/recording chosen (no customer data in frame; use own account).
- [ ] Publish order suggestion: PH first (needs midnight PT timing), HN same morning,
      X thread after HN has a URL to quote.
