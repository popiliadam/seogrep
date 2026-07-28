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
format (`packages/core/src/gsc/crypto.ts`) a **headered blob (v2 and v3) carries the id of the key that
opens it**; **pre-v2 (v1) rows carry no id at all and are opened by trying the ring's keys in turn**. Either way a row
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
   `TOKEN_ENCRYPTION_KEYS` on both, leaving `2:<new>`. From that moment **nothing sealed under key 1 opens
   again** — pre-v2 rows AND every v2 row stamped with key id 1; all of those users must re-connect.
   **Count the SURVIVORS, not the v1 rows — and count on the KEY ID byte, not the version byte.** A row
   survives only if its `encrypted_refresh_token` starts with magic `53 47 53 4c` **and its 6th byte (the
   key id) is `02`** — i.e. it was written after the Phase 2 flip. The 5th byte is the FORMAT version and
   is `02` or `03` depending on when the row was written; keying the count on it is how this check goes
   stale on the next format bump. The reconnect population is *everything else*: rows with no magic at all
   (pre-v2) **plus** every row whose 6th byte is `01`. Counting only "v1 rows" is the trap: on today's live
   configuration `TOKEN_ENCRYPTION_KEYS` is unset, so the ring is `{1: TOKEN_ENCRYPTION_KEY}` and **every
   row written today is key id 1** — a v1 count would come back ~zero and hide the entire
   population that retiring key 1 is about to break.
   **There is NO automatic re-seal.** The only code path that writes a token is the connect-callback
   upsert (`apps/web/lib/gsc/store.ts`); `pull_gsc_data` reads and never writes back, and lazy re-seal is
   deliberately not built. A key-id-1 row therefore stays key-id-1 **forever**, until that user manually
   reconnects. Retire immediately on exposure — otherwise treat it as a planned reconnect wave, not
   something that resolves itself by waiting.
   Two caveats on the prefix count: the format is really decided by the GCM auth tag, not the magic bytes,
   so a pre-v2 row whose random IV happens to open with those 6 bytes (≈1 in 2^48) would be miscounted as a
   survivor; and because Disconnect deletes the row, a count taken now is an **upper bound** on the
   reconnects you will actually owe.

### (e) Sealed-token format v3 — the token is bound to its row (read before ANY bulk row operation)
Since M-17, `encryptToken` feeds the owning `(user_id, project_id)` to AES-GCM as Additional Authenticated
Data. The ids are **not stored in the blob** — the reader rebuilds them from the row it is reading — so the
auth tag only verifies when a blob is opened from the row it was sealed for. That is what stops a token
being moved between rows by anyone holding write access to the table.

**The operational consequence: an `encrypted_refresh_token` value can no longer be moved or copied between
rows, even legitimately.** Re-pointing a connection at a different `project_id`, merging two users,
hand-editing `user_id`, or a partial restore that reassigns ids all make that token permanently unopenable
— the affected user must reconnect through `/app`. A restore or dump/reload that preserves `user_id` and
`project_id` exactly is unaffected. There is no re-key or re-bind tool; do not write one that decrypts and
re-seals under new ids, because that is the exact capability the binding exists to deny.

**When do v2 rows end? Only when their users reconnect — and nothing makes that happen.**
Every connection made before this deploy is a v2 blob, still readable and still *unbound*: a v2 row can
still be swapped, so M-17 is closed for new connections and shrinking for old ones, not closed outright.
The only code path that writes a token is the connect-callback upsert (`apps/web/lib/gsc/store.ts`);
`pull_gsc_data` reads and never writes back. **There is NO automatic re-seal, no background migration, and
no lazy upgrade on read** — a v2 row stays v2 forever until that user clicks Disconnect/Connect again.
If the remaining v2 population has to end on a schedule, the only honest lever is asking those users to
reconnect. Count them the same way as above: magic `53 47 53 4c` with 5th byte `02`.

Notes:
- With `TOKEN_ENCRYPTION_KEYS` unset the code derives `{1: TOKEN_ENCRYPTION_KEY}` and writes under id 1 —
  that is today's live configuration and needs no action.
- v3 is the same length as v2 on the wire (the binding lives in the tag), so no column or storage change.
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
