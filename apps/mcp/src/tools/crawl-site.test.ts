import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  makeCrawlSiteTool,
  type ActiveCrawlFinder,
  type CrawlSiteDeps,
  type EnqueueFn,
  type EstimateFn,
  type ProjectResolver,
} from "./crawl-site.ts";
import type { RankingSeedFetcher, RankingSeedOutcome } from "./crawl-seeds.ts";
import { DEFAULT_TIME_BUDGET_MS } from "../crawler/crawl.ts";
import type { AuthContext } from "../auth.ts";

/**
 * Fast-lane specs for the crawl_site tool SURFACE. All cases here reject at schema
 * validation (before any DB read or enqueue), so no stack is touched. The enqueue port
 * is a spy that must NEVER be reached on invalid input — proving the referee condition
 * that a schema error never reaches the credit/queue machinery. The happy path (real
 * project read + enqueue + no ledger charge) is proven in crawl-site.db.test.ts.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

const spyEnqueue = (): ReturnType<typeof vi.fn<EnqueueFn>> =>
  vi.fn<EnqueueFn>(async () => ({ jobId: "job-should-not-happen" }));

/** "Nothing is in flight for this project" — the state every spec assumes unless it says otherwise. */
const noActiveCrawl: ActiveCrawlFinder = async () => null;

/**
 * The fast lane's tool factory. It supplies ONE dep the specs below do not otherwise name: the
 * in-flight-crawl port (B-1), whose real implementation reads the jobs table — and this lane is
 * DB-free by construction. Every other dep is passed through untouched, and any spec that cares
 * about the guard passes its own `findActiveCrawl`, which wins over this default.
 */
const makeTool = (deps: CrawlSiteDeps = {}) =>
  makeCrawlSiteTool({ findActiveCrawl: noActiveCrawl, ...deps });

describe("crawl_site input schema (referee: project_id + max_urls + include_paths)", () => {
  it("advertises project_id + max_urls + include_paths + the reserved confirm — never timing knobs", () => {
    const tool = makeTool({ enqueue: spyEnqueue() });
    const schema = tool.inputJsonSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "confirm",
      "include_paths",
      "max_urls",
      "project_id",
      "seed_from_ranking_pages",
    ]);
    // The paid opt-in is a BOOLEAN and is never required — a caller who says nothing buys nothing.
    expect(schema.properties.seed_from_ranking_pages).toMatchObject({ type: "boolean" });
    // The CrawlOptions test-timing knobs must NEVER leak onto the tool surface.
    for (const knob of ["pageTimeoutMs", "timeBudgetMs", "crawlDelayCapMs"]) {
      expect(schema.properties).not.toHaveProperty(knob);
    }
    // `confirm` REVERSED, on an operator ruling (2026-09-02), and the reason is S1: the schemas now
    // REFUSE unknown keys, so leaving the flag unadvertised turned this tool's own large-site
    // prompt — "Re-run with `confirm: true`" — into an instruction a schema-validating client
    // could not follow. It is still a RESERVED REGISTRY parameter: no zod schema declares it, the
    // registry injects it into the advertised schema alone (ToolSpec.confirmsInHandler), and the
    // parse strips it before the tool's own fields are validated. Optional, and never required.
    expect(schema.properties.confirm).toMatchObject({ type: "boolean" });
    // max_urls + include_paths are optional; only project_id is required.
    expect(schema.required).toEqual(["project_id"]);
    expect(schema.properties.max_urls).toMatchObject({ type: "integer", minimum: 1, maximum: 100 });
    expect(schema.properties.include_paths).toMatchObject({ type: "array", items: { type: "string" } });
  });

  /**
   * BOTH ceilings, not just the flattering one (B-6). MEASURED LIVE 2026-09-02: a whole-site crawl
   * of a real domain returned 51 pages and 138 skipped — "time budget exhausted after 91s — the
   * crawl stopped on TIME, not at the 100-page limit". The FINISH sentence says that honestly;
   * what nothing said BEFOREHAND was that a second ceiling exists at all, so "up to 100 pages" set
   * an expectation the same 20 credits often does not meet.
   *
   * The seconds figure is DERIVED from the crawler's own constant here rather than retyped, so
   * this asserts the WIRING: moving the budget without moving the sentence turns it red.
   */
  it("max_urls names the TIME budget too — the ceiling that usually binds first", () => {
    const schema = makeTool({ enqueue: spyEnqueue() }).inputJsonSchema as {
      properties: Record<string, { description?: string }>;
    };
    const description = schema.properties.max_urls?.description ?? "";
    expect(description).toMatch(/1–100/);
    expect(description).toContain(`${DEFAULT_TIME_BUDGET_MS / 1000}-second`);
    expect(description).toMatch(/time budget/i);
  });
});

describe("crawl_site surface rejects invalid input before enqueuing", () => {
  it("rejects a non-uuid project_id without enqueuing", async () => {
    const enqueue = spyEnqueue();
    const result = await makeTool({ enqueue }).run(CTX, { project_id: "not-a-uuid" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a missing project_id without enqueuing", async () => {
    const enqueue = spyEnqueue();
    const result = await makeTool({ enqueue }).run(CTX, {});
    expect(result.isError).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects max_urls out of the 1..100 range without enqueuing", async () => {
    const enqueue = spyEnqueue();
    const tool = makeTool({ enqueue });
    const id = randomUUID();
    expect((await tool.run(CTX, { project_id: id, max_urls: 0 })).isError).toBe(true);
    expect((await tool.run(CTX, { project_id: id, max_urls: 101 })).isError).toBe(true);
    expect((await tool.run(CTX, { project_id: id, max_urls: 3.5 })).isError).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

// --- Free pre-discovery + honest large-site confirmation (T35) ------------------
// All hermetic: the project resolver + estimate + enqueue are injected, so no DB / network.

const PID = "11111111-1111-4111-8111-111111111111";
const resolveProject: ProjectResolver = async () => ({
  id: PID,
  domain: "big.example.com",
  archivedAt: null, // active — the archived case has its own spec below
});
const estimateOf = (pages: number | null): EstimateFn => async () => ({
  pages,
  source: pages === null ? "unknown" : "sitemap",
});

/** A capturing enqueue spy: records the single call's args and returns a fixed job_id. */
function captureEnqueue(): {
  fn: EnqueueFn;
  calls: Parameters<EnqueueFn>[];
} {
  const calls: Parameters<EnqueueFn>[] = [];
  const fn: EnqueueFn = async (ctx, input) => {
    calls.push([ctx, input]);
    return { jobId: "job-crawl-1" };
  };
  return { fn, calls };
}

interface ConfirmationBody {
  requires_confirmation: boolean;
  run_cost_credits: number;
  pages_per_crawl: number;
  site_pages_estimate: number;
  site_pages_is_lower_bound: boolean;
  site_pages_source: string;
  full_site_projection: { credits: number; runs: number; note: string };
  message: string;
}

describe("crawl_site large-site confirmation (dynamic D17 projection)", () => {
  it("fires confirmation for a very large site (unconfirmed): NOT enqueued, projection labeled", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    // 1500 pages -> ceil(1500/100)=15 runs -> 300 credits projected (> 200 threshold).
    const tool = makeTool({ enqueue, resolveProject, estimate: estimateOf(1500) });
    const result = await tool.run(CTX, { project_id: PID });

    expect(calls).toHaveLength(0); // NOTHING enqueued, NOTHING charged
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0]!.text) as ConfirmationBody;
    expect(body.requires_confirmation).toBe(true);
    expect(body.run_cost_credits).toBe(20);
    expect(body.pages_per_crawl).toBe(100); // the per-crawl cap (not this run's coverage)
    expect(body.site_pages_estimate).toBe(1500);
    expect(body.full_site_projection).toMatchObject({ credits: 300, runs: 15 });
    expect(body.message).toMatch(/"confirm": true/);
    expect(body.message).toMatch(/include_paths/);
    // The figure is a FLOOR, in the prose and in the structured body — a client reading the
    // number must be able to learn that without parsing English.
    expect(body.message).toMatch(/at least 1,500 pages/i);
    expect(body.message).not.toMatch(/about 1,500 pages/i);
    expect(body.site_pages_is_lower_bound).toBe(true);
    expect(body.site_pages_source).toBe("sitemap");
  });

  it("HONESTY: states the real 20-credit charge and never presents the projection as the charge", async () => {
    const tool = makeTool({
      enqueue: captureEnqueue().fn,
      resolveProject,
      estimate: estimateOf(1500),
    });
    const body = JSON.parse((await tool.run(CTX, { project_id: PID })).content[0]!.text) as ConfirmationBody;

    // The ACTUAL charge is stated, structured, and equals the flat per-run cost.
    expect(body.run_cost_credits).toBe(20);
    expect(body.message).toMatch(/20 credits is the only charge/i);
    // The projection is a SEPARATE, explicitly-labeled field — never the charge.
    expect(body.full_site_projection.credits).toBe(300);
    expect(body.full_site_projection.note).toMatch(/not charged/i);
    // The prose disclaims the projection in words: informational, not a charge, nothing charged.
    expect(body.message).toMatch(/informational projection, NOT a charge/i);
    expect(body.message).toMatch(/no credits have been charged/i);
    // The projection number must NEVER be framed as an amount that will be charged.
    expect(body.message).not.toMatch(/(charged?|charge you|will cost you)\s+(roughly\s+)?300/i);
    expect(body.message).not.toMatch(/300 credits (will|to) be charged/i);
  });

  it("does NOT confirm exactly AT the 200-credit projection boundary (1000 pages)", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    // 1000 pages -> 10 runs -> 200 credits, which is NOT strictly above the threshold.
    const tool = makeTool({ enqueue, resolveProject, estimate: estimateOf(1000) });
    const result = await tool.run(CTX, { project_id: PID });
    expect(calls).toHaveLength(1); // enqueued, no confirmation
    expect(result.content[0]!.text).toContain("status: queued");
  });

  it("confirms just above the boundary (1100 pages -> 220 credits projected)", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeTool({ enqueue, resolveProject, estimate: estimateOf(1100) });
    const body = JSON.parse((await tool.run(CTX, { project_id: PID })).content[0]!.text) as ConfirmationBody;
    expect(calls).toHaveLength(0);
    expect(body.requires_confirmation).toBe(true);
    expect(body.full_site_projection.credits).toBe(220);
  });

  it("confirm:true proceeds: enqueues and carries include_paths in the payload", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeTool({ enqueue, resolveProject, estimate: estimateOf(1500) });
    const result = await tool.run(CTX, {
      project_id: PID,
      include_paths: ["/blog"],
      confirm: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual({
      tool: "crawl_site",
      projectId: PID,
      payload: { max_urls: 100, include_paths: ["/blog"] },
    });
    expect(result.content[0]!.text).toContain("status: queued");
  });

  it("confirm:true SKIPS pre-discovery (estimator not called) but still enqueues include_paths", async () => {
    let estimateCalls = 0;
    const spyEstimate: EstimateFn = async () => {
      estimateCalls++;
      return { pages: 1500, source: "sitemap" };
    };
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeTool({ enqueue, resolveProject, estimate: spyEstimate });
    await tool.run(CTX, { project_id: PID, include_paths: ["/blog"], confirm: true });
    expect(estimateCalls).toBe(0); // the ~30s pre-discovery is skipped on the confirmed path
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].payload).toEqual({ max_urls: 100, include_paths: ["/blog"] });
  });

  it("rejects an include_paths entry that is an empty string (schema hardening)", async () => {
    let estimateCalls = 0;
    const spyEstimate: EstimateFn = async () => {
      estimateCalls++;
      return { pages: 30, source: "sitemap" };
    };
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeTool({ enqueue, resolveProject, estimate: spyEstimate });
    const result = await tool.run(CTX, { project_id: PID, include_paths: [""] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/invalid input/i);
    expect(calls).toHaveLength(0); // rejected at schema, before any handler work
    expect(estimateCalls).toBe(0);
  });

  /**
   * B-2. This reply used to say `status: queued` flat, and the docs promised the same — a state
   * the tracking tool can essentially never confirm. MEASURED LIVE 2026-09-02: the jobs row is
   * INSERTed `queued` and a worker claimed it 562 ms later, while the call itself returned the
   * job_id after 851 ms (9 032 ms on the unconfirmed path). By the time the caller holds the id,
   * the job is already `running` — so `get_job_status`'s queued sentence is unreachable through
   * the documented flow, and a customer comparing the two answers sees a contradiction that is
   * only ever OUR wording's fault.
   *
   * The fix is the sentence, not the state: `queued` is what the row genuinely is at INSERT.
   */
  it("does not promise a status the tracker will almost never confirm", async () => {
    const { fn: enqueue } = captureEnqueue();
    const tool = makeTool({ enqueue, resolveProject, estimate: estimateOf(null) });
    const text = (await tool.run(CTX, { project_id: PID })).content[0]!.text;
    expect(text).toContain("status: queued or already running");
  });

  it("a small site enqueues normally with an honest one-liner and no confirmation", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeTool({ enqueue, resolveProject, estimate: estimateOf(30) });
    const result = await tool.run(CTX, { project_id: PID });
    expect(calls).toHaveLength(1);
    const text = result.content[0]!.text;
    expect(text).toContain("estimated_credits: 20");
    // A LOWER BOUND, said as one. Pre-discovery said "~28" for a site whose own crawl queue
    // found 222+ (measured 2026-08-25): a "~" in front of a number that can only be too low
    // tells the customer it might be too high, while they approve the spend.
    expect(text).toMatch(/at least 30 pages discovered/i);
    expect(text).not.toMatch(/~30/);
    expect(text).not.toMatch(/requires_confirmation/);
  });

  it("names the DISCOVERY SOURCE, and warns that a homepage-only count is far from the truth", async () => {
    const { fn: enqueue } = captureEnqueue();
    const homepageOnly: EstimateFn = async () => ({ pages: 28, source: "homepage" });
    const fromSitemap: EstimateFn = async () => ({ pages: 28, source: "sitemap" });

    const viaHome = (
      await makeTool({ enqueue, resolveProject, estimate: homepageOnly }).run(CTX, {
        project_id: PID,
      })
    ).content[0]!.text;
    expect(viaHome).toMatch(/at least 28 pages discovered/i);
    expect(viaHome).toMatch(/links on the homepage only/i);
    expect(viaHome).toMatch(/very likely larger/i);

    const viaSitemap = (
      await makeTool({ enqueue, resolveProject, estimate: fromSitemap }).run(CTX, {
        project_id: PID,
      })
    ).content[0]!.text;
    expect(viaSitemap).toMatch(/counted from your sitemap/i);
    // The two branches must not read alike: only the weaker one carries the warning.
    expect(viaSitemap).not.toMatch(/very likely larger/i);
  });

  it("degrades to a normal enqueue (no one-liner) when pre-discovery returns null", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeTool({ enqueue, resolveProject, estimate: estimateOf(null) });
    const result = await tool.run(CTX, { project_id: PID });
    expect(calls).toHaveLength(1);
    expect(calls[0]![1].payload).toEqual({ max_urls: 100 }); // no include_paths when unscoped
    expect(result.content[0]!.text).not.toMatch(/pages discovered/);
  });

  it("degrades to a normal enqueue when pre-discovery THROWS (best-effort, never blocks)", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const throwing: EstimateFn = async () => {
      throw new Error("pre-discovery boom");
    };
    const tool = makeTool({ enqueue, resolveProject, estimate: throwing });
    const result = await tool.run(CTX, { project_id: PID });
    expect(calls).toHaveLength(1);
    expect(result.isError).toBeUndefined();
  });

  /**
   * The per-tool archive proof. The refusal itself lives in ONE place (project-target.ts) and
   * has its own spec there — but that spec cannot see whether crawl_site actually goes through
   * it. A tool that kept its own project read would leave the resolver's spec green and archive
   * nothing. So each converted tool asserts the refusal through its OWN handler.
   *
   * Nothing is enqueued, which is what makes the refusal free: crawl_site charges in the WORKER
   * (charge: "worker"), so a call that never reaches enqueue never reaches the ledger.
   */
  it("refuses an ARCHIVED project — nothing enqueued, no pre-discovery", async () => {
    let estimateCalled = false;
    const estimate: EstimateFn = async () => {
      estimateCalled = true;
      return { pages: 30, source: "sitemap" };
    };
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeTool({
      enqueue,
      estimate,
      resolveProject: async () => ({
        id: PID,
        // The fixture domain carries no form of the matched word, so the assertion below cannot
        // pass off an unrelated message as the archive refusal.
        domain: "retired-shop.com",
        archivedAt: "2026-08-13T00:00:00Z",
      }),
    });
    const result = await tool.run(CTX, { project_id: PID });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/archived/i);
    expect(calls).toHaveLength(0);
    expect(estimateCalled).toBe(false);
  });

  it("still fails ownership BEFORE any pre-discovery when the project is not found", async () => {
    let estimateCalled = false;
    const estimate: EstimateFn = async () => {
      estimateCalled = true;
      return { pages: 1500, source: "sitemap" };
    };
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeTool({
      enqueue,
      estimate,
      resolveProject: async () => null, // missing / another tenant's project
    });
    const result = await tool.run(CTX, { project_id: PID });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/no project found/i);
    expect(estimateCalled).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

// --- One crawl per project at a time (B-1) -------------------------------------------
//
// MEASURED 2026-09-02 (docs/audits/tools/2026-09/crawl_site.md, B-1): enqueueJob INSERTs
// unconditionally and this handler asked nothing before it, so a second crawl_site for a project
// whose first crawl was still running opened a SECOND job — and the worker bound a second
// 20-credit reserve for the same pages. The scenario has a named cell in the live sweep plan
// ("does a second identical crawl charge again", plan.mjs:273) that has never been run.
//
// What these specs measure is the SURFACE's decision, with every paid path injected: the enqueue
// (whose job is what the worker's reserve is keyed to), the free pre-discovery, and the SEPARATELY
// CHARGED ranking-seed lookup. "Nothing was charged" is asserted as "none of those three was
// reached", which is the only form of it this lane can honestly prove.

/** An active-crawl finder that reports one in-flight job, and records what it was asked. */
function activeCrawlSpy(
  active: { jobId: string; status: "queued" | "running" } | null,
): { fn: ActiveCrawlFinder; calls: { userId: string; projectId: string }[] } {
  const calls: { userId: string; projectId: string }[] = [];
  const fn: ActiveCrawlFinder = async (ctx, projectId) => {
    calls.push({ userId: ctx.userId, projectId });
    return active;
  };
  return { fn, calls };
}

describe("crawl_site refuses to queue a SECOND crawl while one is in flight", () => {
  it("returns the running job instead of opening a new one — no enqueue, no size check, no paid seeding", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const seed = seedSpy();
    let estimateCalls = 0;
    const spyEstimate: EstimateFn = async () => {
      estimateCalls++;
      return { pages: 30, source: "sitemap" };
    };
    const finder = activeCrawlSpy({ jobId: "job-in-flight-1", status: "running" });

    const result = await makeTool({
      enqueue,
      resolveProject,
      estimate: spyEstimate,
      fetchSeeds: seed.fn,
      findActiveCrawl: finder.fn,
    }).run(CTX, { project_id: PID, seed_from_ranking_pages: true });

    // NOTHING was opened and nothing was bought on this call's behalf.
    expect(calls).toHaveLength(0); // no second jobs row -> no second worker reserve
    expect(seed.calls).toHaveLength(0); // the separately-charged lookup was never made
    expect(estimateCalls).toBe(0); // the 8-second free size check was skipped too

    // It is a NORMAL answer, not an error: the caller asked for a crawl and there is one.
    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toMatch(/already running — poll it with get_job_status/);
    expect(text).toContain("job_id: job-in-flight-1");
    expect(text).toContain("status: running");
    expect(text).toMatch(/not charged/i);
  });

  it("asks for THIS caller's job on THIS project — the finder is tenant-scoped by its arguments", async () => {
    const finder = activeCrawlSpy({ jobId: "job-in-flight-2", status: "queued" });
    await makeTool({
      enqueue: captureEnqueue().fn,
      resolveProject,
      estimate: estimateOf(null),
      findActiveCrawl: finder.fn,
    }).run(CTX, { project_id: PID });
    expect(finder.calls).toEqual([{ userId: CTX.userId, projectId: PID }]);
  });

  it("reports the QUEUED state as queued — it does not relabel a job it did not start", async () => {
    const finder = activeCrawlSpy({ jobId: "job-in-flight-3", status: "queued" });
    const result = await makeTool({
      enqueue: captureEnqueue().fn,
      resolveProject,
      estimate: estimateOf(null),
      findActiveCrawl: finder.fn,
    }).run(CTX, { project_id: PID });
    expect(result.content[0]!.text).toContain("status: queued");
    expect(result.content[0]!.text).toContain("job_id: job-in-flight-3");
  });

  /**
   * The CONTROL. Without it a guard that refused EVERY crawl would pass every spec above, and
   * the tool would be broken in the one way nobody would test for.
   */
  it("queues normally when nothing is in flight for the project", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const finder = activeCrawlSpy(null);
    const result = await makeTool({
      enqueue,
      resolveProject,
      estimate: estimateOf(30),
      findActiveCrawl: finder.fn,
    }).run(CTX, { project_id: PID });
    expect(calls).toHaveLength(1);
    expect(result.content[0]!.text).toContain("job_id: job-crawl-1");
    // The queued reply's own status clause reads "queued or already running" (B-2), so the
    // negative has to name the REFUSAL's sentence rather than the two words the two share.
    expect(result.content[0]!.text).not.toMatch(/is already running — poll it/);
    expect(result.content[0]!.text).toContain("Crawl queued for");
  });

  /**
   * ORDER MATTERS, and this is the half a "does it refuse?" spec cannot see: the in-flight check
   * must sit BEHIND the ownership and archive gates. A project that is missing or another
   * tenant's must never reach a query about its jobs — asking would be a read on behalf of a
   * caller who has not been shown to own the row.
   */
  it("never asks about jobs for a project the caller does not own, or an archived one", async () => {
    const missing = activeCrawlSpy(null);
    await makeTool({
      enqueue: captureEnqueue().fn,
      resolveProject: async () => null,
      findActiveCrawl: missing.fn,
    }).run(CTX, { project_id: PID });
    expect(missing.calls).toHaveLength(0);

    const archived = activeCrawlSpy(null);
    await makeTool({
      enqueue: captureEnqueue().fn,
      resolveProject: async () => ({
        id: PID,
        domain: "retired.example.com",
        archivedAt: "2026-08-13T00:00:00Z",
      }),
      findActiveCrawl: archived.fn,
    }).run(CTX, { project_id: PID });
    expect(archived.calls).toHaveLength(0);
  });

  /**
   * `confirm: true` is the flag that SKIPS pre-discovery, and it is exactly the call a caller
   * makes twice in a row after reading a large-site prompt. It must not skip this gate too.
   */
  it("a confirmed re-run does not bypass the in-flight check", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const finder = activeCrawlSpy({ jobId: "job-in-flight-4", status: "running" });
    const result = await makeTool({
      enqueue,
      resolveProject,
      estimate: estimateOf(1500),
      findActiveCrawl: finder.fn,
    }).run(CTX, { project_id: PID, confirm: true });
    expect(calls).toHaveLength(0);
    expect(result.content[0]!.text).toContain("job_id: job-in-flight-4");
  });
});

// --- OPT-IN ranking-page seeding (imza paketi madde 12) -------------------------------
// The seeding step itself is injected: what is measured here is the SURFACE's decisions —
// whether it runs at all, what reaches the queue payload, and what the caller is told.

/** A seeding spy that records every call and answers with a fixed outcome. */
function seedSpy(outcome: Partial<RankingSeedOutcome> = {}): {
  fn: RankingSeedFetcher;
  calls: Parameters<RankingSeedFetcher>[0][];
} {
  const calls: Parameters<RankingSeedFetcher>[0][] = [];
  const fn: RankingSeedFetcher = async (request) => {
    calls.push(request);
    return {
      kind: "seeded",
      seeds: ["https://big.example.com/pricing"],
      rowsReturned: 1,
      offSite: 0,
      outOfScope: 0,
      creditsCharged: 40,
      note: "Seeded this crawl with 1 of the pages DataForSEO reports as ranking.",
      ...outcome,
    };
  };
  return { fn, calls };
}

describe("crawl_site ranking-page seeding is OPT-IN and priced separately", () => {
  it("DEFAULT OFF: a call that does not ask for seeding never reaches the paid lookup", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const seed = seedSpy();
    const tool = makeTool({
      enqueue,
      resolveProject,
      estimate: estimateOf(null),
      fetchSeeds: seed.fn,
    });
    const result = await tool.run(CTX, { project_id: PID });

    // THE PRICE GUARANTEE: no vendor lookup, so crawl_site still costs exactly its own 20.
    expect(seed.calls).toHaveLength(0);
    expect(calls[0]![1].payload).toEqual({ max_urls: 100 });
    expect(result.content[0]!.text).toContain("estimated_credits: 20");
    expect(result.content[0]!.text).not.toMatch(/DataForSEO/i);
  });

  it("explicit false is the same as saying nothing", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const seed = seedSpy();
    const tool = makeTool({
      enqueue,
      resolveProject,
      estimate: estimateOf(null),
      fetchSeeds: seed.fn,
    });
    await tool.run(CTX, { project_id: PID, seed_from_ranking_pages: false });
    expect(seed.calls).toHaveLength(0);
    expect(calls[0]![1].payload).toEqual({ max_urls: 100 });
  });

  it("opting in carries the seeds to the worker and states the separate charge", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const seed = seedSpy();
    const tool = makeTool({
      enqueue,
      resolveProject,
      estimate: estimateOf(null),
      fetchSeeds: seed.fn,
    });
    const result = await tool.run(CTX, {
      project_id: PID,
      max_urls: 30,
      include_paths: ["/blog"],
      seed_from_ranking_pages: true,
    });

    // The seeding step is asked in the TENANT's name, for THIS project, under THIS crawl's caps.
    expect(seed.calls).toEqual([
      {
        userId: CTX.userId,
        domain: "big.example.com",
        maxUrls: 30,
        includePaths: ["/blog"],
      },
    ]);
    expect(calls[0]![1].payload).toEqual({
      max_urls: 30,
      include_paths: ["/blog"],
      seed_urls: ["https://big.example.com/pricing"],
    });
    // The crawl's own price is UNCHANGED and the seeding fee is a separate sentence.
    expect(result.content[0]!.text).toContain("estimated_credits: 20");
    expect(result.content[0]!.text).toContain("ranking");
  });

  it("a seeding that produced nothing sends no seed_urls, still queues, and says it was free", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const seed = seedSpy({
      kind: "empty",
      seeds: [],
      creditsCharged: 0,
      note: "DataForSEO named no ranking page this crawl could use as a starting point. The crawl was queued without them, and you were not charged for the seeding.",
    });
    const tool = makeTool({
      enqueue,
      resolveProject,
      estimate: estimateOf(null),
      fetchSeeds: seed.fn,
    });
    const result = await tool.run(CTX, { project_id: PID, seed_from_ranking_pages: true });

    expect(calls).toHaveLength(1); // the crawl still runs
    expect(calls[0]![1].payload).toEqual({ max_urls: 100 }); // no seed_urls key at all
    expect(result.content[0]!.text).toContain("status: queued");
    expect(result.content[0]!.text).toMatch(/not charged for the seeding/i);
  });

  it("does NOT buy seeds for a call that returns the large-site confirmation instead of queuing", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const seed = seedSpy();
    const tool = makeTool({
      enqueue,
      resolveProject,
      estimate: estimateOf(1500),
      fetchSeeds: seed.fn,
    });
    const result = await tool.run(CTX, { project_id: PID, seed_from_ranking_pages: true });
    expect(calls).toHaveLength(0);
    // Nothing was enqueued, so nothing may have been spent on its behalf.
    expect(seed.calls).toHaveLength(0);
    expect(JSON.parse(result.content[0]!.text).requires_confirmation).toBe(true);
  });

  it("does NOT buy seeds for a project that is missing or archived", async () => {
    const seed = seedSpy();
    const missing = makeTool({
      enqueue: captureEnqueue().fn,
      resolveProject: async () => null,
      fetchSeeds: seed.fn,
    });
    expect((await missing.run(CTX, { project_id: PID, seed_from_ranking_pages: true })).isError).toBe(true);

    const archived = makeTool({
      enqueue: captureEnqueue().fn,
      resolveProject: async () => ({
        id: PID,
        domain: "retired.example.com",
        archivedAt: "2026-08-13T00:00:00Z",
      }),
      fetchSeeds: seed.fn,
    });
    expect((await archived.run(CTX, { project_id: PID, seed_from_ranking_pages: true })).isError).toBe(true);

    expect(seed.calls).toHaveLength(0);
  });
});
