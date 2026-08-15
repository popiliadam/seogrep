import { describe, expect, it } from "vitest";
import { analyzeTitleQueryMatch } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import type { AuditCrawl, AuditPage, CrawlLoad } from "../audit/index.ts";
import { NO_CRAWL_MESSAGE } from "../audit/index.ts";
import { NO_PULL_MESSAGE, type PullData, type PullLoad } from "../gsc-data/index.ts";
import { gscRow, pullData } from "../gsc-data/fixtures.ts";
import { ARCHIVED_PROJECT_MESSAGE } from "./project-target.ts";
import { makeContentAuditTool } from "./audit-content.ts";
import { formatContentMismatches } from "./audit-content-format.ts";
import type { ContentAuditReport, ContentAuditRunTarget } from "./audit-content-runs.ts";
import { auditContentTool } from "./index.ts";
import { TOOL_COSTS } from "../credits/costs.ts";

/**
 * audit_content, fast lane — everything about the tool that does not need a database.
 *
 * DB-LESS BY CONSTRUCTION: every loader and the writer is injected as a port, and the tool is
 * built under the 0-CREDIT name `whats_next` so `withCredits` short-circuits before it opens a DB
 * client (the trick every sibling spec in this directory uses).
 *
 * WHAT THIS LANE THEREFORE CANNOT SEE, stated plainly rather than left to be discovered: the
 * NAME that reaches the ledger, and the 12-credit reserve/commit/release around it. Those are not
 * waved through — they are asserted over the REAL `audit_content` tool against a live stack in
 * audit-content.db.test.ts, which is the only place they can be measured honestly. The two lanes
 * are complementary, and the pin below that the description quotes TOOL_COSTS is the one
 * price-facing fact this lane CAN check.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
const PULL_JOB_ID = "11112222-3333-4444-5555-666677778888";
const CRAWL_JOB_ID = "99998888-7777-6666-5555-444433332222";
const PULLED_AT = "2026-08-06T09:00:00.000Z";
const FETCHED_AT = "2026-08-07T10:00:00.000Z";

/**
 * A pull whose CURRENT window seeds one of each outcome against the crawl below:
 *   - "trail running shoes" → /trail: every word is on the page (title + h1) → NOT a finding;
 *   - "waterproof trail shoes" → /trail: "waterproof" is nowhere → a finding, 900 impressions;
 *   - "leather boots" → /boots: neither word is on the page → a finding, 200 impressions;
 *   - "hiking poles" → /uncrawled: the page is not in the crawl → unmatched, never a finding.
 * The two findings' impressions and clicks disagree on purpose, so the ordering is measured.
 */
const PULL: PullData = pullData(
  [
    gscRow({ query: "trail running shoes", page: "https://shop.test/trail", impressions: 1500, clicks: 40, position: 4 }),
    gscRow({ query: "waterproof trail shoes", page: "https://shop.test/trail", impressions: 900, clicks: 2, position: 12 }),
    gscRow({ query: "leather boots", page: "https://shop.test/boots", impressions: 200, clicks: 30, position: 9 }),
    gscRow({ query: "hiking poles", page: "https://shop.test/uncrawled", impressions: 50, clicks: 1, position: 15 }),
  ],
  [],
);

function crawlPage(over: Partial<AuditPage> & { url: string }): AuditPage {
  return {
    status: 200,
    title: null,
    metaDescription: null,
    h1s: [],
    canonical: null,
    robotsMeta: null,
    links: [],
    wordCount: 100,
    jsonLdTypes: [],
    ...over,
  };
}

const CRAWL: AuditCrawl = {
  pages: [
    crawlPage({
      url: "https://shop.test/trail",
      title: "Trail shoes",
      h1s: ["Trail running shoes for every season"],
    }),
    crawlPage({ url: "https://shop.test/boots", title: "Our winter range" }),
  ],
  skipped: [],
  fetchedAt: FETCHED_AT,
};

interface Written {
  readonly target: ContentAuditRunTarget;
  readonly report: ContentAuditReport;
}

interface BuildOptions {
  readonly pull?: PullLoad;
  readonly crawl?: CrawlLoad;
  readonly archivedAt?: string | null;
  readonly failWrite?: boolean;
}

const OK_PULL: PullLoad = { ok: true, pull: PULL, pulledAt: PULLED_AT, jobId: PULL_JOB_ID };
const OK_CRAWL: CrawlLoad = { ok: true, crawl: CRAWL, jobId: CRAWL_JOB_ID };

function buildTool(written: Written[], options: BuildOptions = {}) {
  return makeContentAuditTool("whats_next", {
    loadPull: async () => options.pull ?? OK_PULL,
    loadCrawl: async () => options.crawl ?? OK_CRAWL,
    loadProject: async () =>
      options.archivedAt === undefined
        ? null
        : { id: PROJECT_ID, domain: "shop.test", archivedAt: options.archivedAt },
    writeRun: async (target, report) => {
      if (options.failWrite) throw new Error("audit_content_runs write failed (simulated)");
      written.push({ target, report });
    },
  });
}

async function textOf(written: Written[] = [], options: BuildOptions = {}): Promise<string> {
  const result = await buildTool(written, options).run(CTX, { project_id: PROJECT_ID });
  expect(result.isError).toBeUndefined();
  return result.content[0]?.text ?? "";
}

describe("the tool surface", () => {
  it("is registered in ALL_TOOLS under its own name and price", () => {
    expect(auditContentTool.name).toBe("audit_content");
    expect(TOOL_COSTS.audit_content).toBe(12);
  });

  /**
   * The cost sentence is INTERPOLATED from TOOL_COSTS, never typed twice. A hardcoded number here
   * is a second source of truth for a price, and the one the user reads before spending.
   */
  it("quotes the credit cost from the table rather than a literal", () => {
    expect(auditContentTool.description).toContain(`Costs ${TOOL_COSTS.audit_content} credits.`);
  });

  it("requires project_id and nothing else", () => {
    expect(auditContentTool.inputJsonSchema).toMatchObject({
      type: "object",
      required: ["project_id"],
    });
    expect(Object.keys((auditContentTool.inputJsonSchema as { properties: object }).properties)).toEqual([
      "project_id",
    ]);
  });
});

describe("preconditions — every refusal throws, so the reserve is released", () => {
  /**
   * A REFUSAL MUST THROW. `withCredits` commits a handler that RETURNS, so an errorResult here
   * would charge 12 credits for being told which tool to run first. The type matters as much as
   * the throw: the registry keys on PreconditionNotMetError to print the sentence verbatim, and a
   * plain Error is swallowed by the generic "failed unexpectedly, quote reference X" branch.
   */
  it("no pull: says to run pull_gsc_data first", async () => {
    const tool = buildTool([], { pull: { ok: false, error: NO_PULL_MESSAGE } });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /run pull_gsc_data first/i,
    );
  });

  it("no crawl: says to run crawl_site first", async () => {
    const tool = buildTool([], { crawl: { ok: false, error: NO_CRAWL_MESSAGE } });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /run crawl_site first/i,
    );
  });

  /**
   * MISSING BOTH: the PULL is named, not the crawl. A crawl needs only a domain; a pull needs a
   * connected Google account, a matched property and a completed run — so naming the harder step
   * first gives a next action that actually unblocks the tool, instead of sending the caller to
   * crawl_site and refusing again afterwards.
   */
  it("missing both inputs names the pull, the harder one to satisfy", async () => {
    const tool = buildTool([], {
      pull: { ok: false, error: NO_PULL_MESSAGE },
      crawl: { ok: false, error: NO_CRAWL_MESSAGE },
    });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /run pull_gsc_data first/i,
    );
  });

  it("an archived project is refused before either read, and told how to restore it", async () => {
    const written: Written[] = [];
    const tool = buildTool(written, { archivedAt: "2026-08-01T00:00:00.000Z" });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      ARCHIVED_PROJECT_MESSAGE,
    );
    expect(written).toEqual([]);
  });

  /**
   * OWNERSHIP, and why it has no branch of its own. Another tenant's project — archived or not —
   * must be indistinguishable from an id that does not exist, so the archive gate stands aside on
   * a project that did not RESOLVE (loadProject answers null for both) and the tenant-scoped pull
   * loader answers NO_PULL_MESSAGE. A tool that said "that project is archived" here would be an
   * existence oracle for other tenants' project ids.
   */
  it("another tenant's project reads as 'no pull', never as 'archived'", async () => {
    const tool = buildTool([], { pull: { ok: false, error: NO_PULL_MESSAGE } });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(NO_PULL_MESSAGE);
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.not.toThrow(
      /archived/i,
    );
  });
});

describe("the delivered report", () => {
  it("lists the mismatching queries, biggest demand first, and names the missing words", async () => {
    const text = await textOf();
    expect(text).toContain('"waterproof trail shoes" → https://shop.test/trail');
    expect(text).toContain('missing "waterproof"');
    expect(text).toContain('"leather boots" → https://shop.test/boots');
    // Impressions order (900 then 200), NOT clicks order (30 then 2).
    expect(text.indexOf("waterproof trail shoes")).toBeLessThan(text.indexOf("leather boots"));
  });

  it("does not report a query whose words are carried by the page's h1", async () => {
    expect(await textOf()).not.toContain("trail running shoes");
  });

  it("states the join's coverage and names crawl_site for the pages it could not check", async () => {
    const text = await textOf();
    expect(text).toContain("Checked 3 of 4 query/page pairs against 2 of the 2 crawled pages.");
    expect(text).toContain("1 could not be checked");
    expect(text).toContain("run crawl_site again");
  });

  it("prints the pull window, its date, and the crawl's own date", async () => {
    const text = await textOf();
    expect(text).toContain("Analyzed window: 2026-04-19..2026-07-17 (90 days)");
    expect(text).toContain("Search Console data pulled 2026-08-06");
    expect(text).toContain("Crawl data fetched 2026-08-07.");
  });

  it("prints the row-cap caveat when the pull was truncated", async () => {
    const capped: PullData = { ...PULL, current: { ...PULL.current, capped: true } };
    const text = await textOf([], {
      pull: { ok: true, pull: capped, pulledAt: PULLED_AT, jobId: PULL_JOB_ID },
    });
    expect(text).toMatch(/covers at most [\d,]+ rows per window/);
  });

  it("omits the crawl date line rather than blanking it when the crawl carried none", async () => {
    const undated: AuditCrawl = { ...CRAWL, fetchedAt: null };
    const text = await textOf([], { crawl: { ok: true, crawl: undated, jobId: CRAWL_JOB_ID } });
    expect(text).not.toContain("Crawl data fetched");
    expect(text).toContain("Search Console data pulled");
  });

  /**
   * A run that finds NOTHING is a delivered analysis and says so plainly — it is charged, so the
   * reply must not read like a failure.
   */
  it("says so when nothing mismatches", async () => {
    const clean: AuditCrawl = {
      ...CRAWL,
      pages: [
        crawlPage({
          url: "https://shop.test/trail",
          title: "Waterproof trail running shoes",
        }),
      ],
    };
    const text = await textOf([], {
      crawl: { ok: true, crawl: clean, jobId: CRAWL_JOB_ID },
    });
    expect(text).toContain("No title/h1 mismatches found");
  });

  /**
   * The text the caller reads is the formatter's rendering of the SAME engine call that produced
   * the stored row — recomputed here independently rather than read back off the reply, so this
   * compares two renderings instead of comparing a value with itself.
   */
  it("prints exactly what the engine + formatter produce", async () => {
    const expected = formatContentMismatches(
      analyzeTitleQueryMatch(
        PULL.current.rows.map((r) => ({
          query: r.query,
          page: r.page,
          impressions: r.impressions,
          clicks: r.clicks,
        })),
        CRAWL.pages.map((p) => ({ url: p.url, title: p.title, h1s: p.h1s })),
      ),
    );
    expect((await textOf()).startsWith(`${expected}\n\n`)).toBe(true);
  });
});

describe("the recorded run", () => {
  it("writes ONE row keyed to the tenant, the project, and BOTH input jobs", async () => {
    const written: Written[] = [];
    await textOf(written);
    expect(written).toHaveLength(1);
    expect(written[0]?.target).toEqual({
      userId: CTX.userId,
      projectId: PROJECT_ID,
      pullJobId: PULL_JOB_ID,
      crawlJobId: CRAWL_JOB_ID,
    });
  });

  it("stores the engine's structure — the numbers a panel reads, not the sentence", async () => {
    const written: Written[] = [];
    await textOf(written);
    const report = written[0]?.report;
    expect(typeof report).not.toBe("string");
    expect(report?.total).toBe(2);
    expect(report?.top).toEqual({
      query: "waterproof trail shoes",
      page: "https://shop.test/trail",
      impressions: 900,
    });
    expect(report?.analyzed).toBe(3);
    expect(report?.unmatched_rows).toBe(1);
    expect(report?.matched_pages).toBe(2);
    expect(report?.crawl_pages).toBe(2);
  });

  /**
   * BOTH provenance facts travel with the report. The window because every count here is measured
   * over it, and the crawl's timestamp because a mismatch is a claim about the page AS CRAWLED.
   */
  it("records the pull's window and the crawl's date", async () => {
    const written: Written[] = [];
    await textOf(written);
    expect(written[0]?.report.window).toMatchObject({
      days: 90,
      start_date: "2026-04-19",
      end_date: "2026-07-17",
      capped: false,
    });
    expect(written[0]?.report.crawled_at).toBe(FETCHED_AT);
  });
});

describe("a run that cannot be recorded is not delivered", () => {
  /**
   * FAIL-CLOSED. The tool THROWS, so withCredits releases the reserve — the ledger half is
   * asserted over a REAL database rejection in audit-content.db.test.ts. Caught and logged
   * instead, the caller would pay for an audit the panel will forever say never ran.
   */
  it("propagates a failed write instead of swallowing it", async () => {
    const tool = buildTool([], { failWrite: true });
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /audit_content_runs write failed/i,
    );
  });

  /** A load with no job id has nowhere to point the row, and 0026 has BOTH columns NOT NULL. */
  it.each([
    { name: "pull", pull: { ok: true, pull: PULL, pulledAt: PULLED_AT } as PullLoad },
    { name: "crawl", crawl: { ok: true, crawl: CRAWL } as CrawlLoad },
  ])("refuses to deliver when the $name load carried no job id", async (options) => {
    const written: Written[] = [];
    const tool = buildTool(written, options);
    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(/no job id/i);
    expect(written).toEqual([]);
  });
});
