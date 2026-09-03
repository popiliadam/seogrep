import { describe, expect, it } from "vitest";
import { analyzeTitleQueryMatch } from "@pseo/core";
import type { AuthContext } from "../auth.ts";
import type { AuditCrawl, AuditPage, CrawlLoad } from "../audit/index.ts";
import { NO_CRAWL_MESSAGE } from "../audit/index.ts";
import { NO_PULL_MESSAGE, type GscRow, type PullData, type PullLoad } from "../gsc-data/index.ts";
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

/**
 * The delivered text for an arbitrary demand/supply pair, through the REAL tool.
 *
 * Every case below drives the whole path — engine, brand gate, function-word gate, formatter —
 * rather than calling a renderer with a row built by hand. A spec that assembles its own row
 * proves what the spec can build, not what the customer reads.
 */
function textFor(rows: GscRow[], pages: AuditPage[], property: string): Promise<string> {
  return textOf([], {
    pull: {
      ok: true,
      pull: pullData(rows, [], 90, property),
      pulledAt: PULLED_AT,
      jobId: PULL_JOB_ID,
    },
    crawl: { ok: true, crawl: { ...CRAWL, pages }, jobId: CRAWL_JOB_ID },
  });
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

  /**
   * `job_id` REACHES THE CRAWL LOADER. The schema assertion below proves the field is ACCEPTED;
   * this proves it is USED — a tool that declared the selector and then loaded the newest crawl
   * anyway would pass every schema check and still audit the wrong pages, which is the failure the
   * field exists to end.
   */
  it("hands the caller's job_id to the crawl loader, and names that crawl", async () => {
    const seen: (string | undefined)[] = [];
    const chosen = "12345678-aaaa-4bbb-8ccc-dddddddddddd";
    const tool = makeContentAuditTool("whats_next", {
      loadPull: async () => OK_PULL,
      loadCrawl: async (_u, _p, jobId) => {
        seen.push(jobId);
        return { ok: true, crawl: CRAWL, jobId: jobId ?? CRAWL_JOB_ID, requested: true };
      },
      loadProject: async () => null,
      writeRun: async () => {},
    });

    const result = await tool.run(CTX, { project_id: PROJECT_ID, job_id: chosen });

    expect(seen).toEqual([chosen]);
    expect(result.content[0]?.text).toMatch(/^Audited crawl 12345678 from /);
  });

  /**
   * `project_id` is the ONLY required field, and `job_id` is the only optional one. The two halves
   * are asserted separately on purpose: `required` is the money-shaped claim (nothing else may be
   * demanded before a 12-credit call), and the property list is the surface claim — a third field
   * appearing here is a change to what the LLM may send and should cost a deliberate edit.
   */
  it("requires project_id and offers job_id, and nothing else", () => {
    expect(auditContentTool.inputJsonSchema).toMatchObject({
      type: "object",
      required: ["project_id"],
    });
    expect(Object.keys((auditContentTool.inputJsonSchema as { properties: object }).properties)).toEqual([
      "project_id",
      "job_id",
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
  it("lists the mismatching queries under their page, biggest demand first, with the missing words", async () => {
    const text = await textOf();
    // The page heads its own block and carries the title ONCE; the query sits under it.
    expect(text).toMatch(/^• https:\/\/shop\.test\/trail — .*Current title: "Trail shoes"$/m);
    expect(text).toMatch(/^\s+- "waterproof trail shoes" — .*missing "waterproof"/m);
    expect(text).toMatch(/^• https:\/\/shop\.test\/boots — /m);
    // Impressions order (900 then 200), NOT clicks order (30 then 2).
    expect(text.indexOf("shop.test/trail")).toBeLessThan(text.indexOf("shop.test/boots"));
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
    // The block sits between the coverage disclosure and the provenance footer now (the operator
    // signed the move 2026-08-25), so its POSITION is pinned by the test below and its CONTENT
    // here. Anchored on both sides so a rendering that merely contains the words somewhere
    // cannot pass.
    expect(await textOf()).toContain(`\n\n${expected}\n\n`);
  });

  /**
   * THE COVERAGE DISCLOSURE LEADS (operator-approved 2026-08-25, price unchanged at 12 credits).
   *
   * Measured on dentnotion.com the same day: the honest sentence — 1,065 of 6,972 pairs checked,
   * 5,907 unreachable because the page drawing them was not crawled — was the LAST line, under
   * fifty rows. A ratio that changes how the whole list should be read has to arrive before the
   * list, not after it. The sentence itself is unchanged; only where it sits.
   */
  it("LEADS with the coverage disclosure, before any finding", async () => {
    const text = await textOf();
    // The scope sentence (which crawl was judged, audit/load.ts) now sits above it — one line
    // about the INPUT, then the coverage ratio about the ANSWER. Both are still before the list,
    // which is the property this test was cut to defend.
    const lines = text.split("\n\n");
    expect(lines[0]).toMatch(/^Audited /);
    expect(lines[1]?.startsWith("Checked 3 of 4 query/page pairs")).toBe(true);
    expect(text.indexOf("could not be checked")).toBeLessThan(text.indexOf("Current title:"));
  });
});

/**
 * THE BRAND, measured live on dentnotion.com 2026-08-25. The tool reported, verbatim:
 *   `"dent notion" -> https://dentnotion.com/seferihisar-dis-klinigi — 137 impressions;
 *    missing "dent", "notion" (0/2 words present)`
 * The firm's own name, handed back to the firm as a keyword its page fails to mention. It had no
 * brand notion at all; the rule now comes from the shared matcher over the project's domain root.
 */
describe("the customer's own brand is never a missing word", () => {
  const brandedTools = (
    query: string,
    title: string,
    host = "dentnotion.com",
  ): Promise<string> => {
    const page = `https://${host}/seferihisar-dis-klinigi`;
    return textOf([], {
      pull: {
        ok: true,
        pull: pullData(
          [gscRow({ query, page, impressions: 137, clicks: 1, position: 8 })],
          [],
          90,
          `sc-domain:${host}`,
        ),
        pulledAt: PULLED_AT,
        jobId: PULL_JOB_ID,
      },
      crawl: {
        ok: true,
        crawl: { ...CRAWL, pages: [crawlPage({ url: page, title })] },
        jobId: CRAWL_JOB_ID,
      },
    });
  };

  it("drops the measured row: the brand alone is not a finding", async () => {
    const text = await brandedTools("dent notion", "Seferihisar Diş Kliniği");
    expect(text).toContain("No title/h1 mismatches found");
    expect(text).not.toContain('missing "dent"');
  });

  it("says how many it excluded and why, rather than dropping them silently", async () => {
    const text = await brandedTools("dent notion", "Seferihisar Diş Kliniği");
    expect(text).toContain("Excluded 1 query whose only missing words were your own brand name");
  });

  it("drops a misspelling of the brand too", async () => {
    const text = await brandedTools("dentmotion", "Seferihisar Diş Kliniği");
    expect(text).toContain("No title/h1 mismatches found");
  });

  /**
   * The other half, and the one that keeps this from becoming a suppression machine: only the
   * BRAND words go. Everything the customer could actually act on is still reported, with the
   * counts corrected rather than left describing the pre-filter list.
   */
  it("keeps the non-brand words of a branded query and re-counts what is present", async () => {
    const text = await brandedTools("dent notion implant fiyatlari", "Seferihisar Diş Kliniği");
    expect(text).toContain('missing "implant", "fiyatlari"');
    expect(text).not.toContain('"dent"');
    expect(text).toContain("(2/4 words present)");
  });

  it("does not swallow a common-word domain's real finding", async () => {
    const text = await brandedTools("dental implants", "Our winter range", "dental.com");
    expect(text).toContain('missing "implants"');
    expect(text).toMatch(/^1 page with queries whose words are missing from them/m);
  });

  it("prints no exclusion note when the brand excluded nothing", async () => {
    expect(await textOf()).not.toContain("Excluded");
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

/**
 * S10b — THE SAME PAGE, OVER AND OVER.
 *
 * Measured on dentnotion.com 2026-08-25: fifty rows, THIRTY-THREE of them the same url
 * (`/zirkonyum-vs-porselen-kaplama`). Two thirds of a twelve-credit report spent re-listing one
 * page, and the customer left to group it by hand before it meant anything.
 */
describe("the report is grouped by page", () => {
  const CROWDED = "https://shop.test/zirkonyum";
  const SINGLE = "https://shop.test/porselen";
  const CROWDED_QUERIES = ["alfa", "beta", "gama", "delta", "epsilon", "zeta", "eta", "teta"];

  /**
   * The crowded page's rows are individually SMALLER than the other page's single row (100 down
   * to 93, against 500) but sum to far more (772). Ordering by page total therefore disagrees
   * with ordering by biggest row — which is what makes this fixture measure the change of unit
   * rather than agreeing with the old order by accident.
   */
  const CROWDED_ROWS: GscRow[] = [
    ...CROWDED_QUERIES.map((word, index) =>
      gscRow({
        query: `zirkonyum ${word}`,
        page: CROWDED,
        impressions: 100 - index,
        clicks: 1,
        position: 10,
      }),
    ),
    gscRow({ query: "porselen kaplama", page: SINGLE, impressions: 500, clicks: 4, position: 9 }),
  ];

  const CROWDED_PAGES: AuditPage[] = [
    crawlPage({ url: CROWDED, title: "Kaplama" }),
    crawlPage({ url: SINGLE, title: "Kaplama" }),
  ];

  const crowdedText = (): Promise<string> =>
    textFor(CROWDED_ROWS, CROWDED_PAGES, "sc-domain:shop.test");

  it("prints each page ONCE, not once per query", async () => {
    const text = await crowdedText();
    expect(text.split(CROWDED).length - 1).toBe(1);
    expect(text.split(SINGLE).length - 1).toBe(1);
  });

  it("says how many of the page's queries mismatch, and puts them under it", async () => {
    const text = await crowdedText();
    expect(text).toMatch(new RegExp(`^• ${CROWDED} — 8 queries missing words,`, "m"));
    // Indented query lines, all belonging to the crowded page.
    expect(text.match(/^\s+- "zirkonyum /gm)).toHaveLength(5);
  });

  it("counts the queries it did not print instead of printing them", async () => {
    expect(await crowdedText()).toMatch(/…and 3 more of this page's queries/);
  });

  /**
   * The page worth opening first is the one leaking the most demand IN TOTAL — one title edit
   * serves every query under it. A row-ordered list would have put /porselen (500 in one row)
   * above /zirkonyum (772 across eight).
   */
  it("orders pages by the demand the PAGE leaks, not by its biggest single row", async () => {
    const text = await crowdedText();
    expect(text.indexOf(CROWDED)).toBeLessThan(text.indexOf(SINGLE));
  });

  it("headlines the count of PAGES, the unit the reader acts on", async () => {
    expect(await crowdedText()).toMatch(/^2 pages with queries whose words are missing/m);
  });

  /**
   * The page cap gets the same treatment as every other cap in this file: what it left out is
   * COUNTED, never silently dropped.
   */
  it("counts the pages the page cap left out", async () => {
    const many = Array.from({ length: 13 }, (_unused, index) =>
      gscRow({
        query: `zirkonyum ${index}`,
        page: `https://shop.test/p-${index}`,
        impressions: 100 - index,
        clicks: 0,
        position: 10,
      }),
    );
    const pages = many.map((row) => crawlPage({ url: row.page, title: "Kaplama" }));
    const text = await textFor(many, pages, "sc-domain:shop.test");
    expect(text).toMatch(/^13 pages with queries whose words are missing/m);
    expect(text.match(/^• https/gm)).toHaveLength(12);
    expect(text).toMatch(/…and 1 more page with mismatching queries\./);
  });
});

/**
 * S10c — THE FOLDED SPELLING WAS SHOWN TO THE CUSTOMER.
 *
 * Verbatim from the same report, with the query the customer actually typed in brackets:
 *   missing "dis"                  [diş]
 *   missing "agrımayan", "curuk"   [ağrımayan çürük]
 *   missing "saglıgı"              [sağlığı]
 *   missing "kulubu"               [kulübü]
 *   missing "mavisehir"            [Mavişehir]
 * The engine's match fold strips combining marks but leaves the dotless ı, so the customer was
 * reading words that exist in no language.
 */
describe("the customer reads the spelling they typed", () => {
  const PAGE = "https://dentnotion.com/zirkonyum-vs-porselen-kaplama";
  const TURKISH_ROWS: GscRow[] = [
    gscRow({ query: "diş ağrımayan çürük", page: PAGE, impressions: 300, clicks: 1, position: 9 }),
    gscRow({ query: "diş sağlığı", page: PAGE, impressions: 200, clicks: 1, position: 9 }),
    gscRow({ query: "mavişehir kulübü", page: PAGE, impressions: 100, clicks: 1, position: 9 }),
  ];
  const turkishText = (): Promise<string> =>
    textFor(TURKISH_ROWS, [crawlPage({ url: PAGE, title: "Kaplama" })], "sc-domain:dentnotion.com");

  it("prints the original spelling of every missing word", async () => {
    const text = await turkishText();
    expect(text).toMatch(/missing "diş", "ağrımayan", "çürük"/);
    expect(text).toMatch(/missing "diş", "sağlığı"/);
    expect(text).toMatch(/missing "mavişehir", "kulübü"/);
  });

  /**
   * The half-folded forms, each measured live. None of them may reach the reply again — and this
   * is the assertion that fails if the display ever falls back to the engine's matching form.
   */
  it.each([["agrımayan"], ["curuk"], ["saglıgı"], ["kulubu"], ["mavisehir"]])(
    "never shows the half-folded %s",
    async (folded) => {
      expect(await turkishText()).not.toContain(folded);
    },
  );

  /**
   * The fold is for MATCHING and nothing else: the counts under a row are the engine's, so
   * restoring the spelling must not disturb what the row claims about the page.
   */
  it("leaves the engine's own arithmetic alone", async () => {
    expect(await turkishText()).toMatch(/missing "diş", "sağlığı" \(0\/2 words present\)/);
  });
});

/**
 * S10c, second half — THE MISSING WORDS WERE FUNCTION WORDS.
 *
 * Thirteen of the fifty measured rows said nothing but `missing "daha", "iyi"` ("more", "good").
 * Telling somebody to put "mı" in a title is not an action.
 */
describe("a finding with nothing to say is dropped, not printed empty", () => {
  const PAGE = "https://dentnotion.com/dis-beyazlatma";
  const PROPERTY = "sc-domain:dentnotion.com";
  const crawled = [crawlPage({ url: PAGE, title: "Diş beyazlatma" })];

  const forQuery = (query: string): Promise<string> =>
    textFor(
      [gscRow({ query, page: PAGE, impressions: 300, clicks: 1, position: 9 })],
      crawled,
      PROPERTY,
    );

  it("drops the measured row whose only missing words were 'daha' and 'iyi'", async () => {
    const text = await forQuery("diş beyazlatma daha iyi");
    expect(text).toContain("No title/h1 mismatches found");
    expect(text).not.toMatch(/missing "daha"/);
  });

  it("says how many it dropped and why, rather than dropping them silently", async () => {
    const text = await forQuery("diş beyazlatma daha iyi");
    expect(text).toMatch(/Excluded 1 query whose only missing words were function words/);
  });

  /**
   * THE ASCII SPELLING, and the one place the ı→i half of the shared fold is load-bearing:
   * Turkish searchers type "nasil" as often as "nasıl", and the list is written the way Turkish
   * writes it. A fold that stopped at diacritics would catch one spelling and miss the other.
   */
  it("drops the row whose only missing word is an ASCII-typed question word", async () => {
    const text = await forQuery("dis beyazlatma nasil");
    expect(text).toContain("No title/h1 mismatches found");
  });

  /**
   * THE BOUNDARY, and the whole reason this gate filters FINDINGS and not WORDS: "iyi" carries
   * nothing in "daha iyi" and everything in "en iyi diş hekimi", a commercial query whose page
   * really should say "diş hekimi". The row survives WHOLE — "iyi" still printed — because one
   * of its words is content. A word filter could not tell the two rows apart.
   */
  it("keeps a row that has one content word, and keeps its function words too", async () => {
    const text = await forQuery("en iyi diş hekimi");
    expect(text).toMatch(/missing "en", "iyi", "hekimi"/);
    expect(text).not.toMatch(/function words/);
  });

  it("prints no function-word note when nothing was excluded", async () => {
    expect(await textOf()).not.toMatch(/function words/);
  });

  /**
   * THE GATE ORDER, which is a rule and not an accident — and was unpinned until a fresh-context
   * referee swapped the two gates and watched the whole suite stay green (2026-08-26).
   *
   * `dentnotion daha iyi` is the shape that separates them. Brand-first: the brand gate strips
   * "dentnotion", the row is left holding "daha" and "iyi", and the function gate drops it.
   * Function-first: the row still contains "dentnotion" when the function gate looks at it, so
   * it is NOT all function words, it survives — and the customer is handed back
   * `missing "daha", "iyi"` on their own brand name, which is both measured defects at once.
   *
   * Nothing about the two gates in isolation says which runs first, so only a query that needs
   * BOTH of them, in one order, can pin it.
   */
  it("runs the brand gate FIRST, so a branded query left holding function words still drops", async () => {
    const branded = `${PAGE}?x=1`;
    const text = await textFor(
      [gscRow({ query: "dentnotion daha iyi", page: branded, impressions: 400, clicks: 1, position: 9 })],
      [crawlPage({ url: branded, title: "Diş beyazlatma" })],
      PROPERTY,
    );
    expect(text).toContain("No title/h1 mismatches found");
    expect(text).not.toMatch(/missing "daha"/);
    // It leaves by the FUNCTION-word door, not the brand one: the brand gate only thinned it.
    expect(text).toMatch(/Excluded 1 query whose only missing words were function words/);
  });
});

/**
 * PAST THE CAP — the one region of this tool no fixture had ever reached, and the region two of
 * its own comments say the design exists for.
 *
 * `audit-content.ts` runs the engine UNCAPPED and applies the cap only after both exclusion gates,
 * and it re-derives `total` from the KEPT list. Both were measured unpinned on 2026-09-02: putting
 * `MAX_CONTENT_MISMATCHES` back as the engine's limit, and setting `total` back to the engine's
 * own count, each left the whole 244-test audit lane green. The reason was the fixtures, not the
 * assertions — the largest crawl in this file produced NINE mismatching pairs against a cap of
 * fifty, so no test could tell a capped engine from an uncapped one.
 *
 * The fixture below is built to straddle the cap deliberately:
 *   · 52 ordinary mismatches at 1000 down to 949 impressions — all survive both gates;
 *   ·  4 brand-only rows at 10..7 impressions — the brand gate drops them;
 *   ·  4 function-word-only rows at 6..3 impressions — the function gate drops them.
 *
 * The eight excluded rows sit BELOW the cap on purpose. Uncapped, the engine hands over all 60,
 * the gates remove 8, `total` is 52 and the shortlist is the first 50. Capped, the engine hands
 * over the top 50 — which contains none of the eight — so both exclusion notes vanish and `total`
 * reads 50. And with `total` taken from the engine instead of the kept list it reads 60, promising
 * the customer ten findings the filters have already thrown away. Three different numbers, one
 * fixture, each of the two invariants failing in its own way.
 */
describe("the cap sits AFTER the filters, and the headline counts what survived them", () => {
  const HOST = "https://brandhost.test";
  const BIG_PROPERTY = `${HOST}/`;
  const ORDINARY = 52;

  const bigRows: GscRow[] = [
    ...Array.from({ length: ORDINARY }, (_, i) =>
      gscRow({
        query: `alpha${i} widget`,
        page: `${HOST}/p${i}`,
        impressions: 1000 - i,
        clicks: 1,
        position: 9,
      }),
    ),
    // Brand-only: the single missing word is the customer's own name.
    ...Array.from({ length: 4 }, (_, i) =>
      gscRow({
        query: "brandhost",
        page: `${HOST}/b${i}`,
        impressions: 10 - i,
        clicks: 0,
        position: 20,
      }),
    ),
    // Function-word-only: "how" and "best" are both in the function list.
    ...Array.from({ length: 4 }, (_, i) =>
      gscRow({
        query: "how best",
        page: `${HOST}/f${i}`,
        impressions: 6 - i,
        clicks: 0,
        position: 25,
      }),
    ),
  ];

  const bigPages: AuditPage[] = bigRows.map((row) =>
    crawlPage({ url: row.page, title: `Untitled ${row.page.slice(HOST.length)}` }),
  );

  /** THE FIXTURE GUARD: every row above really is a mismatch, and there really are more than 50. */
  it("produces 60 mismatching pairs before any filter runs", () => {
    const raw = analyzeTitleQueryMatch(
      bigRows.map((r) => ({
        query: r.query,
        page: r.page,
        impressions: r.impressions,
        clicks: r.clicks,
      })),
      bigPages.map((p) => ({ url: p.url, title: p.title, h1s: p.h1s })),
      Number.MAX_SAFE_INTEGER,
    );
    expect(raw.total).toBe(60);
  });

  it("counts the survivors, not the engine's list, and states the remainder from them", async () => {
    const written: Written[] = [];
    const text = await textOf(written, {
      pull: {
        ok: true,
        pull: pullData(bigRows, [], 90, BIG_PROPERTY),
        pulledAt: PULLED_AT,
        jobId: PULL_JOB_ID,
      },
      crawl: { ok: true, crawl: { ...CRAWL, pages: bigPages }, jobId: CRAWL_JOB_ID },
    });

    // 60 found, 8 filtered, 52 kept — and the shortlist is the first 50 OF THE KEPT.
    expect(written[0]?.report.total).toBe(52);
    expect(text).toContain("…and 2 more query/page pairs mismatch.");
  });

  it("lets the gates see the rows the cap would have hidden, and says how many it dropped", async () => {
    const text = await textOf([], {
      pull: {
        ok: true,
        pull: pullData(bigRows, [], 90, BIG_PROPERTY),
        pulledAt: PULLED_AT,
        jobId: PULL_JOB_ID,
      },
      crawl: { ok: true, crawl: { ...CRAWL, pages: bigPages }, jobId: CRAWL_JOB_ID },
    });

    expect(text).toMatch(/Excluded 4 queries whose only missing words were your own brand name/);
    expect(text).toMatch(/Excluded 4 queries whose only missing words were function words/);
  });
});
