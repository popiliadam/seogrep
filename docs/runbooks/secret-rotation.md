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
  `/status` → `ok` + a numeric `pendingJobs`; a real MCP `tools/list` with the new smoke key → the full
  tool surface (**19** today — never hardcode a stale number when re-running this: the source of truth is
  `ALL_TOOLS` in `apps/mcp/src/tools/index.ts`, mirrored one-file-per-tool under
  `apps/web/content/docs/tools-reference/`);
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

### (d) Token encryption key — keyring rotation  · Netlify + Fly, SAME values
**No precondition.** The old "confirm `gsc_connections` has 0 live rows" step is gone. Since the v2 seal
format (`packages/core/src/gsc/crypto.ts`) a **v2 blob carries the id of the key that opens it**;
**pre-v2 (v1) rows carry no id at all and are opened by trying the ring's keys in turn**. Either way a row
stays readable as long as its key is in the ring, so a rotation neither loses live connections nor depends
on the table being empty. Leave `TOKEN_ENCRYPTION_KEY` set
throughout — it still signs the OAuth `state` — and set each phase on **both** platforms with **identical**
values before moving to the next.

1. `openssl rand -hex 32` → the new key.
2. **Phase 1 — read new, still write old.** On both: `TOKEN_ENCRYPTION_KEYS=1:<old>,2:<new>` and
   `TOKEN_ENCRYPTION_ACTIVE_KEY_ID=1`. Fly: `flyctl secrets set …`; Netlify: set → Trigger redeploy.
   Verify: an EXISTING connection still pulls (`pull_gsc_data`) and a fresh `connect_gsc` round-trips.
3. **Phase 2 — flip writes.** On both: `TOKEN_ENCRYPTION_ACTIVE_KEY_ID=2` → redeploy. Verify: a fresh
   `connect_gsc` round-trips (new rows seal under id 2) AND an old connection still pulls (read leg).
4. **Retire the old key** — the step that actually contains a compromise: drop `1:<old>` from
   `TOKEN_ENCRYPTION_KEYS` on both, leaving `2:<new>`. From that moment nothing sealed under key 1 opens
   again, including every pre-v2 row; those users must re-connect.
   **There is NO automatic re-seal.** The only code path that writes a token is the connect-callback
   upsert (`apps/web/lib/gsc/store.ts`); `pull_gsc_data` reads and never writes back, and lazy re-seal is
   deliberately not built. A v1 row therefore stays v1 **forever**, until that user manually reconnects.
   So before retiring, count how many rows are still v1 and expect exactly that many reconnects: a v2 blob
   begins with the bytes `53 47 53 4c 02` (ASCII `SGSL` + version); any other leading bytes mean v1.
   Retire immediately on exposure — otherwise treat it as a planned reconnect wave, not something that
   resolves itself by waiting.

Notes:
- With `TOKEN_ENCRYPTION_KEYS` unset the code derives `{1: TOKEN_ENCRYPTION_KEY}` and writes under id 1 —
  that is today's live configuration and needs no action.
- A malformed `TOKEN_ENCRYPTION_KEYS` (entries must be `<id>:<64 hex>`, comma separated, ids 1-255) throws
  on the first seal/open rather than falling back to the lone key: `connect_gsc` and `pull_gsc_data` fail
  loudly instead of degrading quietly. If either breaks right after a phase, check the ring's shape first.

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
- healthz `{"ok":true}` · `/status` ok · real-client `tools/list` = the full tool surface (19 today; count
  `ALL_TOOLS`, do not trust this number after a tool ships) · crawl job completes.
- Netlify: fresh signup + `/login` + `connect_gsc` all work.
