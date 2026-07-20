import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  makeCrawlSiteTool,
  type EnqueueFn,
  type EstimateFn,
  type ProjectResolver,
} from "./crawl-site.ts";
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

describe("crawl_site input schema (referee: project_id + max_urls + include_paths)", () => {
  it("advertises project_id + max_urls + include_paths — never timing knobs or the reserved confirm", () => {
    const tool = makeCrawlSiteTool({ enqueue: spyEnqueue() });
    const schema = tool.inputJsonSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "include_paths",
      "max_urls",
      "project_id",
    ]);
    // The CrawlOptions test-timing knobs must NEVER leak onto the tool surface.
    for (const knob of ["pageTimeoutMs", "timeBudgetMs", "crawlDelayCapMs"]) {
      expect(schema.properties).not.toHaveProperty(knob);
    }
    // `confirm` is a RESERVED registry param read from raw input — it must NEVER be advertised
    // in tools/list (the D17 gen-tool-docs guard enforces this too).
    expect(schema.properties).not.toHaveProperty("confirm");
    // max_urls + include_paths are optional; only project_id is required.
    expect(schema.required).toEqual(["project_id"]);
    expect(schema.properties.max_urls).toMatchObject({ type: "integer", minimum: 1, maximum: 100 });
    expect(schema.properties.include_paths).toMatchObject({ type: "array", items: { type: "string" } });
  });
});

describe("crawl_site surface rejects invalid input before enqueuing", () => {
  it("rejects a non-uuid project_id without enqueuing", async () => {
    const enqueue = spyEnqueue();
    const result = await makeCrawlSiteTool({ enqueue }).run(CTX, { project_id: "not-a-uuid" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/invalid input/i);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a missing project_id without enqueuing", async () => {
    const enqueue = spyEnqueue();
    const result = await makeCrawlSiteTool({ enqueue }).run(CTX, {});
    expect(result.isError).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects max_urls out of the 1..100 range without enqueuing", async () => {
    const enqueue = spyEnqueue();
    const tool = makeCrawlSiteTool({ enqueue });
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
const resolveProject: ProjectResolver = async () => ({ id: PID, domain: "big.example.com" });
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
  full_site_projection: { credits: number; runs: number; note: string };
  message: string;
}

describe("crawl_site large-site confirmation (dynamic D17 projection)", () => {
  it("fires confirmation for a very large site (unconfirmed): NOT enqueued, projection labeled", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    // 1500 pages -> ceil(1500/100)=15 runs -> 300 credits projected (> 200 threshold).
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: estimateOf(1500) });
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
  });

  it("HONESTY: states the real 20-credit charge and never presents the projection as the charge", async () => {
    const tool = makeCrawlSiteTool({
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
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: estimateOf(1000) });
    const result = await tool.run(CTX, { project_id: PID });
    expect(calls).toHaveLength(1); // enqueued, no confirmation
    expect(result.content[0]!.text).toContain("status: queued");
  });

  it("confirms just above the boundary (1100 pages -> 220 credits projected)", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: estimateOf(1100) });
    const body = JSON.parse((await tool.run(CTX, { project_id: PID })).content[0]!.text) as ConfirmationBody;
    expect(calls).toHaveLength(0);
    expect(body.requires_confirmation).toBe(true);
    expect(body.full_site_projection.credits).toBe(220);
  });

  it("confirm:true proceeds: enqueues and carries include_paths in the payload", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: estimateOf(1500) });
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
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: spyEstimate });
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
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: spyEstimate });
    const result = await tool.run(CTX, { project_id: PID, include_paths: [""] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/invalid input/i);
    expect(calls).toHaveLength(0); // rejected at schema, before any handler work
    expect(estimateCalls).toBe(0);
  });

  it("a small site enqueues normally with an honest one-liner and no confirmation", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: estimateOf(30) });
    const result = await tool.run(CTX, { project_id: PID });
    expect(calls).toHaveLength(1);
    const text = result.content[0]!.text;
    expect(text).toContain("estimated_credits: 20");
    expect(text).toMatch(/~30 pages discovered/);
    expect(text).not.toMatch(/requires_confirmation/);
  });

  it("degrades to a normal enqueue (no one-liner) when pre-discovery returns null", async () => {
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: estimateOf(null) });
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
    const tool = makeCrawlSiteTool({ enqueue, resolveProject, estimate: throwing });
    const result = await tool.run(CTX, { project_id: PID });
    expect(calls).toHaveLength(1);
    expect(result.isError).toBeUndefined();
  });

  it("still fails ownership BEFORE any pre-discovery when the project is not found", async () => {
    let estimateCalled = false;
    const estimate: EstimateFn = async () => {
      estimateCalled = true;
      return { pages: 1500, source: "sitemap" };
    };
    const { fn: enqueue, calls } = captureEnqueue();
    const tool = makeCrawlSiteTool({
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
