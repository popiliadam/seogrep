import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { makeCrawlSiteTool, type EnqueueFn } from "./crawl-site.ts";
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

describe("crawl_site input schema (referee: only project_id + max_urls)", () => {
  it("advertises ONLY project_id + max_urls — never the crawler's timing knobs", () => {
    const tool = makeCrawlSiteTool({ enqueue: spyEnqueue() });
    const schema = tool.inputJsonSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties).sort()).toEqual(["max_urls", "project_id"]);
    // The CrawlOptions test-timing knobs must NEVER leak onto the tool surface.
    for (const knob of ["pageTimeoutMs", "timeBudgetMs", "crawlDelayCapMs"]) {
      expect(schema.properties).not.toHaveProperty(knob);
    }
    // max_urls is optional (defaulted); only project_id is required.
    expect(schema.required).toEqual(["project_id"]);
    expect(schema.properties.max_urls).toMatchObject({ type: "integer", minimum: 1, maximum: 100 });
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
