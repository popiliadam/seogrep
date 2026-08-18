# Runbook — cloud grant audit

Prepared by: chief. **Run by: a human.** The chief does not read or write the production
database.

> Written in English because this file is read alongside `scripts/ops/cloud-grant-audit.sql`,
> whose comments are English. The other runbooks in this directory are Turkish; if that
> inconsistency matters, this one is the odd file out and should be translated, not the query.

## What this checks, and what nothing else checks

`packages/db/supabase/migrations` grants each application role a deliberately narrow set of
table privileges. On the **cloud** project those grants are not the whole story: the schema's
default ACL adds more at `CREATE TABLE` time. Migration `0028_grant_narrowing.sql` repaired the
relations that existed on 2026-08-18 and revoked the default going forward.

Two things guard it from here:

| guard | what it measures | where it runs |
|---|---|---|
| `guardrails/check-grants.sh` | the **migration text**: every SELECT/INSERT/UPDATE/DELETE decided per relation, per role | `verify.sh` + CI, every push |
| `scripts/ops/cloud-grant-audit.sql` | the **live cloud database** | **manually, by a human, nowhere else** |

The second one cannot be automated from this repo, and pretending otherwise would be worse than
not having it. No CI job can reach the cloud project, and — this is the part that matters — the
divergence **does not exist on a local stack**. The local default ACL for a new public table is
`xtm` (no DML at all); the cloud one is `arwdxtm`. So the same query run locally returns zero
rows regardless of what production is doing. A green local run is not evidence. Only a run
against the cloud project is.

## When to run it

- **Immediately after applying `0028` to the cloud project**, as the acceptance check.
- After applying **any** migration that creates a relation or changes a grant.
- After anyone applies SQL to production by hand (SQL editor, `psql`, a recovery script).
- Periodically — quarterly is enough; the mechanism only fires when a relation is created.

## How to run it

Either transport works; both are read-only.

**Supabase SQL editor** — open the project, paste the whole of
`scripts/ops/cloud-grant-audit.sql`, run. The editor returns three result sets, one per section.

**psql** — with the pooler/direct connection string for the project:

```
psql "$SUPABASE_DB_URL" -f scripts/ops/cloud-grant-audit.sql
```

`SUPABASE_DB_URL` is a production credential: take it from the project settings at the time of
the run, do not commit it, and do not leave it in shell history.

## Reading the output

**(A) default ACLs.** The `postgres` row for `objtype = r` must read
`anon=xtm,authenticated=xtm,service_role=xtm`. Any `a`, `r`, `w` or `d` in it means 0028 part (5)
did not take effect, and **every relation created afterwards will be born wide open again** —
fix this before anything else, because repairing the relations without it only buys time.

The `supabase_admin` row will read `arwdDxtm`. That is expected and is not fixable from a
migration (0016 measured the permission denial). It is harmless only for as long as nothing
creates relations as `supabase_admin`.

**(B) per-relation excess.** **Zero rows is the pass.** Every row is a privilege a role holds on
production that no migration ever granted it. Each row names the relation, the role, the
privilege, and what the migrations actually intended.

A row whose `expected_here` column carries the "relation not in the expected list" text means
something else: a relation exists that the query does not know about. Either a migration added
one and the `expected` list in the query was not updated (fix the query), or a relation was
created outside the migrations (investigate that first).

**(C) gsc_accounts columns.** Expected: `ciphertext_readable = false`,
`panel_columns_readable = true`.

- `ciphertext_readable = true` — an account owner can read their own Google refresh-token
  ciphertext over the Data API. This is the condition 0021 believed a column grant had
  prevented and 0028 actually closed. Treat it as a live finding.
- `panel_columns_readable = false` — the opposite failure: the column grant was destroyed and
  the panel's token-health surface is broken. A table-level `REVOKE SELECT` drops column-level
  entries too, so this is what a repair applied in the wrong order looks like.

## If (B) returns rows

Do not improvise a `REVOKE` at the SQL editor. Re-apply the relevant block of
`0028_grant_narrowing.sql` verbatim — it is subtractive, idempotent, and safe to re-run — then
re-run this audit. If the excess is on a relation 0028 does not name, that relation is newer
than 0028 and the real fix is a new migration plus an update to the `expected` list in the query;
`guardrails/check-grants.sh` should have caught it before merge, so note how it got through.
