# Minimal monitoring runbook (beta)

Audit §7 / G4 (scoped). Before this slice the gateway had **no** monitoring, alerting, or
status surface — only Fly's internal `/healthz` liveness check. There was zero visibility
into 5xx errors, queue backlog, or downtime: the beta was flown blind. This runbook ends
that with two cheap, real signals plus a documented external-uptime setup.

It is **not** an observability platform. No dashboards, no historical metrics, no paging —
that is a deliberate scope cut for this beta slice (see the scope note in §5 and audit G4).

---

## 1. What exists

| Surface | URL / command | Purpose | Wired to Fly check? |
|---|---|---|---|
| `/healthz` | `https://mcp.seogrep.com/healthz` | Liveness. Trivial zero-I/O `{"ok":true}`. | **Yes** — and the external uptime target. |
| `/status` | `https://mcp.seogrep.com/status` | Operator signals (see below). | **No** — never gates liveness. |
| Fly health check | `flyctl checks list --app seogrep-mcp` | Fly's own `GET /healthz` every 15s (2s timeout). | n/a |
| Fly logs | `flyctl logs --app seogrep-mcp` | 5xx error lines, worker output, crashes. | n/a |

**Why `/healthz` and `/status` are separate (do not merge them):** `/healthz` is polled by
Fly every 15s with a **2s timeout** and is also the external uptime target. It MUST stay a
trivial, zero-I/O `{"ok":true}` probe. If a DB or queue query were added to `/healthz`, a
slow database would make the check time out and Fly would **kill a healthy machine** —
turning a slow dependency into an outage. So the richer, DB-touching signals live on the
separate `/status` route, which nothing uses as a liveness gate.

`GET /status` returns:

```json
{ "ok": true, "uptimeSeconds": 1234, "errorsSinceBoot": 0, "pendingJobs": 0,
  "reaperRuns": 0, "reservesReleased": 0, "lastReaperRunAt": null }
```

- **`uptimeSeconds`** — whole seconds since the web process booted.
- **`errorsSinceBoot`** — count of internal-error (500) responses since boot, incremented at
  the two instrumented 500 paths in the MCP endpoint (the request-pipeline catch and the
  MCP-dispatch catch). Because the whole POST pipeline runs inside that try, these cover
  effectively every realistic 500.
- **`pendingJobs`** — jobs in `status in ('queued','running')` — the app's own view of queue
  backlog / stuck work. `null` when the count could not be read in time (see §4).
- **`reaperRuns` / `reservesReleased` / `lastReaperRunAt`** — counters for the stuck-job reaper:
  completed sweeps since boot, credit reserves refunded since boot (cumulative), and the ISO
  timestamp of the last completed sweep. **On this endpoint they are always `0 / 0 / null`.**
  The reaper runs inside the **worker** process, which starts no HTTP listener at all; `/status`
  is served only by the **web** processes, whose in-memory counters never see a sweep. The
  reaper's real heartbeat is the worker's log — see §4.

**In-memory caveat (important):** `uptimeSeconds` and `errorsSinceBoot` are **in-memory and
per-process**. They **reset to zero on every deploy/restart**, and in a multi-machine
deployment each machine has its own counters (the request you happen to hit answers with
that machine's numbers). They are a cheap "is it getting worse right now" signal, **not** a
durable metric. `pendingJobs` is not in-memory — it comes from the database — but it is **served
from a short-lived cache**, so it can be a few seconds stale, and it is still a point-in-time
count, not a time series.

**Two behaviours added by the H-05 hardening — know them before you read a `/status` response:**

- **`pendingJobs` is cached for a few seconds** and concurrent callers share one in-flight read.
  This is deliberate: the count is an unindexed exact scan of `jobs`, so before the cache an
  anonymous flood turned into one full scan per request and the load landed on auth, the queue
  and credit settlement. Treat the number as "correct within the last few seconds", not as live.
- **`/status` can now answer `429`.** It is per-IP throttled. A `429` means *you* are polling too
  fast — it is **not** an outage signal and must never page anyone. If a monitor gets a `429`,
  slow the monitor down; the liveness gate is `/healthz`, which is **not** throttled and is
  unaffected by any of this.

---

## 2. External uptime setup (human, ~5 min)

This is the "end the blind flight" deliverable: a free external monitor that emails the
operator when the gateway is down. Do this once.

1. Create a free account on an uptime service — **UptimeRobot** (uptimerobot.com) or
   **Better Stack / Better Uptime** (betterstack.com) both have a free tier that suffices.
2. Add a new **HTTP(s) monitor**:
   - **URL:** `https://mcp.seogrep.com/healthz`
   - **Expected status:** HTTP `200`.
   - **Keyword / body match (if the tier offers it):** the response body contains
     `{"ok":true}` — so a 200 served by an error page is still caught.
   - **Check interval:** 1–5 minutes (any free-tier interval is fine).
3. **Alerting:** notify after **2 consecutive failures** (avoids paging on a single blip),
   delivered to the **operator email**. Add a second contact if you have one.
4. Save. Confirm the monitor shows **Up**, then (optionally) verify the alert path by
   pointing it briefly at a bad path (e.g. `/healthz-nope`) and confirming the email lands,
   then set it back to `/healthz`.

Target `/healthz`, **not** `/status`: `/healthz` is the true liveness signal and never
depends on the database, so it will not false-alarm when the DB is merely slow.

---

## 3. 5xx / error visibility (minimal path)

There is no error dashboard yet. Today you read errors two ways:

- **Logs (authoritative):** `flyctl logs --app seogrep-mcp`. Every 500 path logs a line.
  Request failures log with the **safe key prefix only** (never the plaintext API key), e.g.
  `MCP request failed for sg_ab… : <reason>`; MCP-dispatch failures log
  `MCP request handling failed: <error>`. Grep the stream for `failed` during an incident.
- **Counter (cheap trend):** poll `GET /status` and watch `errorsSinceBoot`. A number that
  keeps climbing between polls means 5xx are actively happening **now**. Remember it resets
  on deploy and is per-machine (§1), so treat it as a live trend, not a total.

**Minimal alerting available now:**

- Fly's health-check alerting (Fly dashboard / `flyctl`) fires if `/healthz` starts failing
  — i.e. the process is down or wedged.
- The external uptime monitor from §2 emails on sustained `/healthz` failure.
- A hard crash-loop shows up as `flyctl` restarts and as `/healthz` downtime.

Real metrics/tracing and an alerting platform (error-rate thresholds, latency percentiles,
paging) remain **out of scope for this beta slice** — see audit **G4**.

---

## 4. Reading `pendingJobs`

`pendingJobs` counts jobs in `queued` or `running`. **Normal is near 0** — jobs are picked
up and finished quickly by the worker.

- **A sustained climb** (a number that grows and does not drain) means either a **backlog**
  (work arriving faster than the single worker drains it) or **stuck jobs** (a crashed or
  redeployed worker left rows in `running` — often with an open credit reserve).
- When you see a sustained climb, **run the stuck-job reconciliation runbook**:
  [`scripts/reconciliation.md`](./reconciliation.md). Its detection queries (§2 there) show
  exactly which jobs are stuck and whether a credit reserve is open; the one-shot
  `scripts/reconcile.mjs` refunds open reserves and marks the jobs failed.
- **Degradation contract:** if the count cannot be read within
  ~1s (DB slow or down), `/status` returns **`"pendingJobs": null`** and still answers
  `"ok": true`. `null` means "couldn't read the backlog right now," **not** "zero backlog" —
  fall back to `flyctl logs` and the reconciliation runbook. `/status` never hangs or 5xx-es
  on a slow DB by design: it is an operator signal, not a liveness gate. Since H-05 the read is
  also **cancelled** when it passes that deadline, instead of being abandoned to keep running
  against the database — the old behaviour was what made an anonymous flood expensive.

**Automatic reaping (Faz 4 — now live).** The worker process sweeps for stuck jobs **every 10
minutes** on its own (`REAPER_INTERVAL_MS` in `apps/mcp/src/queue/worker.ts`, running the same
`reconcileStuckJobs` the manual script uses). Open reserves are refunded without waiting for a
human. `/status` cannot show this (§1) — watch the **worker's logs**, where every completed sweep
writes one line: `flyctl logs --app seogrep-mcp | grep 'reaper sweep'` →
`reaper sweep: scanned=0 released=0 alreadySettled=0 failed=0 orphanReserves=0`, expected roughly
every 10 minutes.

- **No `reaper sweep:` line for well over 10 minutes** → sweeps are failing or the worker is
  down. A failed sweep is **logged, never fatal**: also grep for `reaper run failed:`. The
  worker keeps draining the queue.
- **`released=` non-zero** → jobs are genuinely crashing mid-run; refunds are happening, but
  find the cause in the logs.

`scripts/reconcile.mjs` remains for **on-demand** runs (an incident, or a sweep you don't want to
wait 10 minutes for) — see [`scripts/reconciliation.md`](./reconciliation.md).

> Still manual: **alerting** on a rising `pendingJobs`. Nothing pages on backlog growth yet (§5).

---

## 5. Scope — what this intentionally does NOT do

This slice is minimal on purpose (beta): give the operator cheap, real signals and a
free external uptime alert, without building an observability platform.

**Since shipped:** automatic periodic reaping of stuck jobs — the worker sweeps every 10
minutes and logs one `reaper sweep:` line per sweep (§4). It is no longer on the deferred list
below. Still not built: surfacing those counters on a *reachable* endpoint — the worker serves no
HTTP, so cross-process metrics stay a `flyctl logs`-only affair for now (no committed phase;
revisit if/when a dedicated observability platform is scoped).

Explicitly **out of scope** for this beta slice (audit **G4**):

- **No dashboards** and **no historical metrics / time series** — the counters are
  in-memory, per-process, and reset on deploy (§1). No storage, no charts.
- **No cross-instance aggregation** — each machine reports its own `uptimeSeconds` /
  `errorsSinceBoot`.
- **No paging / on-call / escalation** and **no error-rate or latency alerting** — the only
  automated alert is external uptime on `/healthz` (§2) plus Fly's health-check alerting.
- **No request/latency counters.** `/status` deliberately omits a `requestsSinceBoot`
  denominator: an always-present request counter adds hot-path surface for marginal beta
  value, and an error **rate** (errors ÷ requests) is exactly the kind of derived metric a
  dedicated metrics platform should own, not this beta slice. The three signals here (uptime,
  `errorsSinceBoot`, `pendingJobs`) map directly onto the audit's three blind spots: downtime,
  5xx, and queue backlog.
- **No tracing** and **no distributed request IDs**.

The guiding rule: `/healthz` must never do I/O (it is the liveness gate), and `/status`
must never hang or 5xx (it is only a signal). Everything richer is intentionally out of
scope for this beta slice.
