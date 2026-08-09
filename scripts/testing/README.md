# `scripts/testing/` — the tool sweep harness

`tool-sweep.mjs` drives the live SeoGrep MCP endpoint across the campaign matrix (8 sites x 19
tools x 6 scenarios, PLAN.md) and records the **raw** response and the **measured** credit delta
of every call. It is a driver and a recorder. It does no analysis: the hypotheses H1–H9 are
answered by hand, later, from the JSONL.

## Run it

```bash
# MCP_SMOKE_URL is not exported by default, and this shell does not source ~/.zshrc.
set -a && . ~/.zshrc >/dev/null 2>&1; set +a

node scripts/testing/tool-sweep.mjs --self-test                       # no network, no disk
node scripts/testing/tool-sweep.mjs --dry-run --layer=K0 --out=/tmp/sweep
node scripts/testing/tool-sweep.mjs --layer=K0 --max-credits=200 --out=/tmp/sweep --resume
```

| flag | meaning |
|---|---|
| `--self-test` | seven offline assertions; the only automated check this directory has |
| `--dry-run` | prints the resolved plan and the projected cost. Issues **zero** `tools/call` |
| `--out=<dir>` | **required**; must be outside the repo working tree |
| `--max-credits=N` | hard ceiling. Required as soon as one selected cell sits on a nonzero-cost tool |
| `--resume` | cells already recorded with a terminal outcome are skipped, not re-bought |
| `--layer=K0,K1` | campaign layers K0–K4 |
| `--scenario=S3` | scenarios S1–S6; matches by prefix, so `S3` selects `S3a`…`S3d` |
| `--site=adstark,seogrep` | site keys from `SITES` in `plan.mjs` |
| `--foreign-project-id=<uuid>` | another tenant's project, for the S4 isolation cells |
| `--job-timeout-ms=N` | crawl polling budget (default 300000) |

`--out` is refused if it resolves inside the repo: the raw records carry customer URLs and
Search Console queries. Derived signal tables belong in `docs/testing/`; anonymised fixtures
belong in the test fixture directory; the raw JSONL belongs nowhere near git.

The endpoint URL and its API key are never printed and never written. Every line, including each
serialised JSONL record, passes through `redact()`, which derives the secrets from the URL at
runtime and collapses them to `sg_***redacted`.

## What is recorded

One JSONL line per cell in `<out>/sweep.jsonl`, append-only:

```
ts · run_id · site · tool · scenario · layer · note · args
expected_cost · unit_cost · balance_before · balance_after · delta · delta_mismatch
outcome · http_status · duration_ms · poll_count? · total_wait_ms? · raw
```

`raw` is the full parsed JSON-RPC response object, never a summary.

`outcome` is a closed set: `ok`, `tool_error`, `requires_confirmation`, `paid_balance_required`,
`transport_error`, `skipped_resume`, `skipped_no_foreign_id`, `skipped_not_applicable`,
`skipped_unresolved`, `dry_run`. A missing prerequisite is a **recorded skip with a reason** — "S4
was not measured" and "S4 passed" must never look alike in the data.

`expected_cost` is a **pre-registered claim**, and `delta` is the measurement. S2/S3/S4 cells
project 0 because the code returns before the reserve (measured 2026-08-08: the premium tools
resolve their target before `withCredits`; the audit tools throw on "no crawl" so the reserve is
released). `delta_mismatch: true` means the claim was wrong — that is the finding, so it warns
and keeps going rather than aborting and hiding the rest of the sweep.

## What this harness does NOT cover

**`guardrails/verify.sh` never sees this directory.** `pnpm-workspace.yaml` lists `apps/*` and
`packages/*` only, so turbo's `typecheck` / `lint` / `test` tasks do not reach `scripts/`. There
is no linter and no type checker here. `--self-test` is the only automated check, and it covers
exactly seven things: the ceiling stops a breaching run before any call, the dry run issues no
calls, resume skips recorded cells and only those, `redact()` removes the key and the URL, the
projection equals the sum of `TOOL_COSTS` over the charged cells, an `--out` inside the repo is
refused, and an unplanned tool fails the coverage assertion.

It does **not** cover: the live schemas (checked at run time, against `tools/list`), the SEO
judgement in the plan, the argument values, or anything needing a socket.

Two more limits worth knowing before reading the output:

- **S2 runs only where "cold" is measurable.** `adstark` and `seogrep` already carry crawls, so
  an audit there would deliver, commit, and raise a meaningless `delta_mismatch` — six false
  entries in the one flag that is supposed to mean "the user paid for an error message", for 100
  credits. The `neverCrawled` predicate excludes them; the K1 S5 `audit_onpage` cell buys the
  re-audit question explicitly instead.
- **Cell count is decided by argument variance, not by site count.** The whole sweep
  authenticates with one API key, so there is exactly one tenant in the run. `S3a`/`S3b`/`S3c`
  take literal constants and `S4` takes one run-level value, so they run on a single site;
  `S3d` varies its arguments per site and runs on one `.com.tr` and one `.com`.
- **`--resume` reads only `<out>/sweep.jsonl`.** Point it at the same `--out` you ran with, or it
  will happily buy everything again. Resumed cells are filtered out before the run and counted in
  the log; `skipped_resume` is never written as a row, so every line in the file is a measurement.
- **A `transport_error` is not terminal** and will be retried by `--resume`. A `tool_error` is: a
  refusal is a result.

## Changing the matrix

Everything is data in `plan.mjs`:

- `SITES` — the eight campaign sites. `gsc` is the **consent** state; flip a site to
  `"connected"` once its owner has actually clicked the OAuth link, and the K2 layer picks it up.
- `ID_TOOLS` — every tool taking `project_id` and/or `target`. The S3 and S4 cells are generated
  from it, and `assertIdToolTable()` checks it against the live schemas at startup, so a newly
  shipped tool cannot be silently left out of the isolation sweep.
- `PLAN` — the static S1/S2/S5/S6 entries, in execution order.
- `EXCLUDED` — tools deliberately not planned, each with a written reason. Empty today.

`TOOL_COSTS` is **imported** from `apps/mcp/src/credits/costs.ts`. Do not copy prices here: that
table is human-approved and is the only source of truth for what a tool charges
(constitution NEVER #6).
