# Runbook — Coordinated Secret Rotation

> **When:** before live money / beta invites, and any time a live credential is exposed (e.g. pasted
> into a chat/log). The 2026-07-20 audit's single CRITICAL was that T16-era prod credentials reached a
> chat transcript and were never rotated.
>
> **Golden rule:** values stay with the operator — never paste a secret value into a chat/agent
> transcript. The operator sets each value; the chief (or any assistant) only follows this list and
> verifies the **result** (Fly digest change + live smoke), never the value.

## Ground rules

- For each secret, set the NEW value on **both** Netlify (web) and Fly (mcp) **before** disabling the
  old one → zero downtime. Verify live, then delete the old.
- After a Fly change, confirm with `flyctl secrets list --app seogrep-mcp` — the **Digest** column
  changes (never by printing the value).
- After the full round, run the smoke: `curl -s https://mcp.seogrep.com/healthz` → `{"ok":true}`;
  `/status` → `ok` + a numeric `pendingJobs`; a real MCP `tools/list` with the new smoke key → 16 tools;
  a crawl job completes (proves pg-boss reconnected); Netlify: fresh signup + `/login` +
  `connect_gsc` start.

## The six rotations

### (a) Supabase service-role key — `SUPABASE_SERVICE_ROLE_KEY`  · Netlify + Fly
1. Supabase → Settings → API keys → generate a new `sb_secret…` service key (keep old active).
2. Netlify: set `SUPABASE_SERVICE_ROLE_KEY` = new → Trigger redeploy.
3. Fly: `flyctl secrets set SUPABASE_SERVICE_ROLE_KEY=<new> --app seogrep-mcp`.
4. Verify web + mcp, then revoke/delete the old key in Supabase.

### (b) Database password → rebuilds `SUPABASE_DB_URL`  · Fly + Netlify
1. Supabase → Database → **Reset database password**.
2. Rebuild the URL as the **session pooler on port 5432** (NOT the 6543 transaction pooler — pg-boss
   needs session state; the repo enforces this):
   `postgresql://postgres.<ref>:<newpass>@<pooler-host>:5432/postgres`.
3. Fly: `flyctl secrets set SUPABASE_DB_URL=<new url> --app seogrep-mcp`; Netlify: set + redeploy.
4. Verify healthz + an async crawl job runs to completion.

### (c) Google OAuth client secret — `GOOGLE_CLIENT_SECRET`  · Netlify
1. Google Cloud Console → Credentials → the OAuth client → **Add secret** (two can be live at once).
2. Netlify: set `GOOGLE_CLIENT_SECRET` = new → redeploy.
3. Verify `connect_gsc` starts, then delete the old secret in Google. (`GOOGLE_CLIENT_ID` is public.)

### (d) Token encryption key — `TOKEN_ENCRYPTION_KEY` (new 64-hex)  · Netlify + Fly, SAME value
1. `openssl rand -hex 32`.
2. Precondition (makes it free): confirm `gsc_connections` has 0 live rows — no encrypted tokens to lose.
3. Fly: `flyctl secrets set TOKEN_ENCRYPTION_KEY=<new> --app seogrep-mcp`; Netlify: set the **same**
   value → Trigger redeploy (both sides must match or token decrypt fails).
4. Verify a fresh `connect_gsc` round-trips (encrypt on web, decrypt on mcp).

### (e) DataForSEO password — `DATAFORSEO_PASSWORD`  · Fly
1. DataForSEO dashboard → reset API password.
2. Fly: `flyctl secrets set DATAFORSEO_PASSWORD=<new> --app seogrep-mcp`.
3. No live smoke while `DFS_LIVE` is off; if DFS is turned on later, smoke `research_keywords` then.
(`DATAFORSEO_LOGIN` unchanged.)

### (f) Exposed smoke API key (the `sg_…` personal key)
1. In the owning SeoGrep account → Connection → **Rotate**.
2. The old plaintext is now dead; use the new key for the smokes above.

## Verification (goes to the ledger)
- `flyctl secrets list --app seogrep-mcp`: digests changed for the rotated Fly secrets.
- healthz `{"ok":true}` · `/status` ok · real-client `tools/list` = 16 tools · crawl job completes.
- Netlify: fresh signup + `/login` + `connect_gsc` all work.
