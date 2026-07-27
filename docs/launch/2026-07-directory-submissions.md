# MCP Directory Submissions (Faz 4 — T-C2)

> Status: submission texts + steps ready. SUBMISSION IS HUMAN-ONLY (contract: dış dünya).
> Research date: 2026-07-27 (all mechanisms verified from official pages unless marked inferred).
> Money items and account items are flagged `[HUMAN-MONEY]` / `[HUMAN-ACCOUNT]`.

## The one description that propagates everywhere (≤100 chars — registry hard cap)

```
SEO for AI agents: crawl sites, audit pages, pull Search Console data, generate shareable reports.
```
(98 chars. The Official Registry caps `description` at 100; PulseMCP and other aggregators
re-use it verbatim — this is the most-seen sentence we will ship. Do not truncate ad hoc.)

## Submission order (leverage-ranked)

| # | Target | Effort | Blocker |
|---|---|---|---|
| 1 | **Official MCP Registry** | DNS TXT + CLI ~1h | none — `{key}` template natively supported, closed-source fine |
| 2 | **PulseMCP** | ~0 (auto-ingests #1 daily) | none |
| 3 | **mcp.so** (remote-server tab) | 5 min | none; `[HUMAN-MONEY]` optional $39 one-time = instant publish + Verified badge + dofollow link |
| 4 | **Smithery** | after T-C3 ships | soft: needs fixed `/mcp` + header auth (path-segment `{key}` not expressible) |
| 5 | **Glama connectors** | ~15 min | verify connector path accepts non-GitHub (inferred) |
| 6 | **Anthropic Connectors Directory** | weeks | `[HUMAN-ACCOUNT]` requires Team/Enterprise Claude org + pre-contact for custom_connection |

## Engineering prerequisites (tracked as tasks, NOT human steps)

- **T-C3 (added to plan):** fixed endpoint `https://mcp.seogrep.com/mcp` accepting the key
  via `x-api-key` (or `Authorization: Bearer`) header, alongside the existing `/mcp/{key}`
  path. Unblocks Smithery; removes Anthropic's credential-in-URL objection; genuinely
  better security posture (keys out of logs/history).
- **Verify 401-not-403:** unauthenticated MCP requests must return **401** (Smithery's
  scanner treats 403 as init failure). Check our auth path's status code during T-C3.
- **(Deferred, pre-Anthropic only) T-C4 tool annotations:** every tool needs `title` +
  `readOnlyHint`/`destructiveHint`, names ≤64 chars, no read/write mixing. Our 16 tools
  are single-purpose (no catch-all), so this is additive metadata. Do when the human
  decides to pursue the Anthropic listing.

---

## 1. Official MCP Registry — registry.modelcontextprotocol.io ✅ **PUBLISHED 2026-07-27**

Live: `com.seogrep/seogrep` v1.0.0 — verified in the registry API (title, description,
websiteUrl and the `{key}` streamable-http remote all present). The exact published
document is committed at `docs/launch/mcp-registry-server.json`.

How it was done (for the next version bump — edit the file, bump `version`, re-run the
last two commands; `mcp-publisher` is installed via Homebrew, v1.8.0):
- Keypair: `openssl genpkey -algorithm ed25519 -out ~/seogrep-mcp-registry.pem` (private
  key stays on the operator's machine, mode 600 — never in the repo or chat).
- DNS TXT on the **apex** `seogrep.com` (added alongside the existing Google-verification
  and ImprovMX SPF records — never replace those, it would break support@ email):
  `v=MCPv1; k=ed25519; p=<base64 of the raw 32-byte public key>`
  Public key: `openssl pkey -in <pem> -pubout -outform DER | tail -c 32 | base64`
- `mcp-publisher login dns --domain seogrep.com --private-key "$(openssl pkey -in <pem> -outform DER | tail -c 32 | xxd -p -c 64)"`
- `mcp-publisher validate` then `mcp-publisher publish`
- Schema note: `init` templates the current schema (`2025-12-11`); the older `2025-09-29`
  validates but prints a deprecation warning.

**Mechanism (reference):** CLI (`mcp-publisher`), no review queue, immediate. Namespace via
DNS: `com.seogrep/seogrep`.

**HUMAN steps:**
1. Chief generates an Ed25519 keypair locally (private key stays with human; never in chat).
2. `[HUMAN]` Add DNS TXT on seogrep.com (Netlify DNS): `v=MCPv1; k=ed25519; p=<base64 pubkey>`.
3. `mcp-publisher login dns --domain seogrep.com --private-key <HEX>` → `mcp-publisher publish`
   with the server.json below (chief prepares the file; human runs the two commands).

**server.json (chief-prepared, ready):**
```json
{
  "name": "com.seogrep/seogrep",
  "title": "SeoGrep",
  "description": "SEO for AI agents: crawl sites, audit pages, pull Search Console data, generate shareable reports.",
  "version": "1.0.0",
  "websiteUrl": "https://seogrep.com",
  "remotes": [{
    "type": "streamable-http",
    "url": "https://mcp.seogrep.com/mcp/{key}",
    "variables": {
      "key": {
        "description": "Your personal key from the SeoGrep dashboard (free trial, no card)",
        "isRequired": true,
        "isSecret": true
      }
    }
  }]
}
```
Note: registry requires the resolved endpoint to be publicly reachable — our per-user URL
template is the documented, sanctioned pattern for exactly this (`isSecret: true`).

## 2. PulseMCP — pulsemcp.com ⏳ **waiting on auto-ingest (published upstream 2026-07-27)**

Auto-ingests the Official Registry daily, processes weekly. **Do nothing after #1.**
If not listed after a week: fallback form `pulsemcp.com/submit` (single URL field —
submit `https://seogrep.com`), or email hello@pulsemcp.com. Listing copy comes from the
registry record (the 98-char description above).

## 3. mcp.so

**Mechanism:** `mcp.so/submit?type=remote-server` (sign-in required). Two fields:
- Remote endpoint URL: `https://mcp.seogrep.com/mcp/{key}` (if the form rejects the
  template, use `https://seogrep.com` and explain the per-user URL in the draft step)
- Name: `SeoGrep`

**`[HUMAN-MONEY]` decision:** free tier = queued review, nofollow link, random placement.
$39 one-time = instant publish, Verified badge, **dofollow** link from a DR-72 site with
self-reported 2.2M visitors/yr. Chief's recommendation: **pay it** — for an SEO product
the dofollow backlink alone likely justifies $39. Human decides (real money).

## 4. Smithery — smithery.ai (AFTER T-C3)

**Mechanism:** account + `smithery.ai/new`, or CLI:
```
smithery mcp publish "https://mcp.seogrep.com/mcp" -n @seogrep/seogrep \
  --config-schema '{"type":"object","properties":{"apiKey":{"type":"string","title":"API Key","x-from":{"header":"x-api-key"}}},"required":["apiKey"]}'
```
Notes: Smithery gateway-proxies to ONE fixed upstream; user config only via header/query
(`x-from`), hence T-C3. Their scanner (`SmitheryBot/1.0`, Cloudflare Workers egress) crawls
tools for the listing — if auth-walled scanning fails, serve a static card at
`/.well-known/mcp/server-card.json` (serverInfo + tools). Return **401, not 403**, to
unauthenticated requests. Post-publish: Settings → Verification for the vendor badge.

## 5. Glama — glama.ai (verify first)

Main flow requires a public GitHub repo — NOT for us. Use "Add MCP Server → Connector"
(remote endpoints). `[HUMAN]` verify on glama.ai that the connector path accepts
non-GitHub hosted servers (research confidence: inferred; their FAQ page was unreachable).

## 6. Anthropic Connectors Directory (longest lead — start when ready)

**Two blockers, in order:**
1. `[HUMAN-ACCOUNT]` Requires a **Team or Enterprise** Claude org (portal lives in
   admin settings; individual plans cannot submit at all). Human decision: stand up a
   Team org for the company or defer this listing.
2. Email **mcp-review@anthropic.com** BEFORE submitting to request `custom_connection`
   auth type ("different users connect to different URLs" — Snowflake-style), or confirm
   `static_headers` beta once T-C3 ships. Chief drafts the email; human sends.

**Portal:** claude.ai/admin-settings/directory/submissions/new

**Listing copy (ready):**
- Server name (≤100): `SeoGrep`
- Tagline (≤55): `grep your site for SEO issues from your AI agent` (48 chars)
- Description (≤2000): use the Show HN long-form (docs/launch/2026-07-launch-posts.md §2)
  minus the implementation bullet-points, plus tool list and trial terms. Chief finalizes
  at submission time (fields: categories 1-5 → SEO / Marketing / Developer Tools;
  docs URL https://seogrep.com/docs; privacy https://seogrep.com/privacy;
  support support@seogrep.com; slug `seogrep` — PERMANENT once published).

**Review-readiness checklist (chief prepares, human executes):**
- [ ] T-C4 tool annotations shipped (title + readOnlyHint/destructiveHint ×16, names ≤64).
- [ ] Reviewer test account provisioned WITH real data (crawl history + report) — "fully
      populated account" is required wording; an empty trial fails.
- [ ] Privacy policy already live ✓ (covers collection/usage/retention/contact — re-read
      against their 5 required topics before submitting).
- [ ] Data handling step: declare DataForSEO as permissioned third-party proxy (when
      DFS_LIVE ships); GSC data = user's own OAuth.
- [ ] Allowlist Anthropic egress `160.79.104.0/21` if we ever add IP gating (we don't today).
- [ ] Every tool returns a real response on valid params (no generic 500s) — smoke via
      MCP Inspector + custom connector before submitting.

**Timeline:** no SLA; queue-dependent (reports range weeks→months). Default label
"Community" (automated scan); Anthropic may auto-escalate to "Verified".

---

## Long-tail (optional, post-launch)

mcpservers.org · mcpmarket.com · mcp.directory · mcpserverhub.net — cheap SEO-backlink
submissions, low distribution value. Cursor Marketplace + Docker MCP Catalog are
repo/container-centric (weak fit; revisit if they add hosted-SaaS paths).
