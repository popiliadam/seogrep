import { describe, expect, it } from "vitest";
import type { AuditCrawl } from "../audit/crawl-data.ts";
import {
  auditOnpage,
  auditSchema,
  auditTech,
  formatOnpageReport,
  formatSchemaReport,
  formatTechReport,
} from "../audit/index.ts";
import type { AuditReport, AuditRunTarget } from "../audit/runs.ts";
import type { AuthContext } from "../auth.ts";
import { makeAuditTool, type RenderAudit } from "./audit-shared.ts";
import { renderOnpageAudit } from "./audit-onpage.ts";
import { renderTechAudit } from "./audit-tech.ts";
import { renderSchemaAudit } from "./audit-schema.ts";

/**
 * The audit-run write (migration 0024) at the level of the shared builder, with no database:
 * does an audit hand the recorder the STRUCTURAL report keyed to the crawl it read, and does the
 * text it returns stay byte-identical to what it returned before the write existed?
 *
 * DB-LESS BY CONSTRUCTION, so the builders are exercised under the 0-CREDIT name `whats_next`
 * (precondition.test.ts's rule): naming `audit_onpage` opens a credit reserve and needs a
 * database. The three engine+formatter pairs are therefore imported as the RENDERS the priced
 * tools are built from — what this lane cannot see is which NAME lands in the row, and that is
 * asserted per tool, over the real tools, in audit-runs.db.test.ts.
 */

const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };
const PROJECT_ID = "11111111-2222-4333-8444-555555555555";
const CRAWL_JOB_ID = "99999999-8888-4777-8666-555555555555";

/** The project port's "did not resolve" answer — the archive gate stands aside on it. */
const NO_PROJECT = async () => null;

/** The prior-run port's "never audited" answer, for every spec that is not about that warning. */
const NO_PRIOR_RUN = async () => null;

/**
 * One crawl, deliberately carrying something for EACH engine to say: a page that is thin and has
 * no meta description (on-page), a 404 and a skipped URL (tech), and one page with JSON-LD while
 * the other has none (schema). A fixture that only tripped one engine would let two of the three
 * snapshots below pass while saying nothing.
 */
const CRAWL: AuditCrawl = {
  pages: [
    {
      url: "https://snap.example/",
      status: 200,
      title: "A good enough page title",
      metaDescription: null,
      h1s: ["Heading"],
      canonical: "https://snap.example/",
      robotsMeta: null,
      links: ["https://snap.example/gone"],
      wordCount: 50,
      jsonLdTypes: ["Organization"],
    },
    {
      url: "https://snap.example/gone",
      status: 404,
      title: "Missing",
      metaDescription: "A description that is comfortably long enough to avoid the short rule.",
      h1s: ["Gone"],
      canonical: null,
      robotsMeta: null,
      links: [],
      wordCount: 400,
      jsonLdTypes: [],
    },
  ],
  skipped: [{ url: "https://snap.example/private", reason: "blocked by robots.txt" }],
  fetchedAt: "2026-08-14T00:00:00.000Z",
};

/** A loader that answers with the fixture above, standing in for the tenant-scoped query. */
const LOAD_OK = async (_u: string, _p: string, jobId?: string) => ({
  ok: true as const,
  crawl: CRAWL,
  jobId: jobId ?? CRAWL_JOB_ID,
  requested: jobId !== undefined,
});

/**
 * THE SCOPE SENTENCE every audit now opens with (audit/load.ts states why it exists). It is
 * spelled out here rather than computed, because it is the customer's first line and this file is
 * where the three audits' delivered text is frozen.
 */
const SCOPE =
  "Audited crawl 99999999 from 2026-08-14: 2 page(s), 1 URL(s) skipped. That is this project's " +
  "most recent crawl — pass job_id (from list_jobs) to audit a different one, or run crawl_site " +
  "again to widen it.";

/**
 * What each audit produced BEFORE this slice: the engine's report and `format<X>Report`'s
 * rendering of it, spelled as the tools used to spell it. Engines and formatters are untouched
 * here, so these are the pre-change bytes by construction.
 */
const FORMATTED = {
  onpage: {
    report: auditOnpage(CRAWL),
    text: formatOnpageReport(auditOnpage(CRAWL), CRAWL.fetchedAt),
  },
  tech: { report: auditTech(CRAWL), text: formatTechReport(auditTech(CRAWL), CRAWL.fetchedAt) },
  schema: {
    report: auditSchema(CRAWL),
    text: formatSchemaReport(auditSchema(CRAWL), CRAWL.fetchedAt),
  },
} as const;

interface Recorded {
  readonly target: AuditRunTarget;
  readonly report: AuditReport;
}

/** A recorder that remembers what it was handed instead of writing it. */
function recorder() {
  const runs: Recorded[] = [];
  return {
    runs,
    writeRun: async (target: AuditRunTarget, report: AuditReport) => {
      runs.push({ target, report });
    },
  };
}

/** One priced audit's render, wired behind the builder under a 0-credit name. */
function toolFor(render: RenderAudit, writeRun: ReturnType<typeof recorder>["writeRun"]) {
  return makeAuditTool("whats_next", "d", render, {
    loadCrawl: LOAD_OK,
    loadProject: NO_PROJECT,
    writeRun,
    // "this crawl has not been audited before" — the DB-less default for every spec that is not
    // about the repeat warning. The real finder reaches getServiceClient and needs a database.
    findPriorRun: NO_PRIOR_RUN,
  });
}

const RENDERS = [
  { name: "audit_onpage", render: renderOnpageAudit },
  { name: "audit_tech", render: renderTechAudit },
  { name: "audit_schema", render: renderSchemaAudit },
] as const;

describe("every priced audit records the run it just performed", () => {
  it.each(RENDERS)("$name writes exactly one run, keyed to the crawl it read", async ({ render }) => {
    const sink = recorder();

    const result = await toolFor(render, sink.writeRun).run(CTX, { project_id: PROJECT_ID });

    expect(result.isError).toBeUndefined();
    expect(sink.runs).toHaveLength(1);
    expect(sink.runs[0]?.target.userId).toBe(CTX.userId);
    expect(sink.runs[0]?.target.projectId).toBe(PROJECT_ID);
    expect(sink.runs[0]?.target.crawlJobId).toBe(CRAWL_JOB_ID);
  });

  /**
   * THE REPORT IS STRUCTURAL. Every engine's report is an object carrying `pageCount`, and none
   * of them is a string — which is what the rendered text would be. This is the assertion that
   * goes red if the builder ever records the reply instead of the measurement.
   */
  it.each(RENDERS)("$name records the engine's report, not the rendered text", async ({ render }) => {
    const sink = recorder();

    await toolFor(render, sink.writeRun).run(CTX, { project_id: PROJECT_ID });

    const report = sink.runs[0]?.report;
    expect(typeof report).toBe("object");
    expect(report).toHaveProperty("pageCount", CRAWL.pages.length);
  });
});

/**
 * BYTE IDENTITY. The write is additive and the reply must not have moved by a single character:
 * these three strings were captured from the tools as they answer today, and they are frozen here
 * rather than recomputed from the formatter — recomputing compares the code against itself and
 * passes through any change the engine and the formatter make together.
 *
 * WHEN A RULE WAVE DELIBERATELY MOVES THEM, the literal is re-frozen and the reason is written
 * here — never quietly. Two such moves so far:
 *
 *  - Faz 2 (broken internal links): `audit_tech` grew two lines. THIS FIXTURE EARNS THEM — the
 *    home page links to `/gone`, and `/gone` is a page THIS crawl fetched and got a 404 from,
 *    which is exactly what the rule reports. The proof that nothing regressed for data the rule
 *    cannot judge is elsewhere and is a stronger measurement than this one: format-graph.test.ts
 *    pins the sha256 of all three renderers over an OLD-SHAPED crawl against the digests measured
 *    on `main`. The other two literals below are untouched.
 *
 *  - S10e (a threshold breach must name its threshold): `audit_onpage` grew ", minimum 200" and
 *    ", minimum 10" on two lines. THIS FIXTURE EARNS THEM — the home page really is 50 words
 *    against a 200-word floor, `/gone`'s title really is 7 chars against a 10-char one, and a
 *    customer told only "thin content (50 words)" cannot tell how far short that is. Two lines
 *    moved, both by a suffix; nothing was added, removed or reordered, and `audit_tech` and
 *    `audit_schema` are untouched.
 *
 *  - S10d (the skipped list states its reason once): `audit_tech`'s one skipped row became two
 *    lines — the reason with its own count, then the URL under it. THIS FIXTURE EARNS THE SHAPE
 *    but not the motive: a live audit printed FIFTY rows carrying that same one reason, and the
 *    repetition hid the only readable fact, which is how many URLs each reason accounts for. One
 *    row here is the smallest case of the same rendering, and it is the one that proves the shape
 *    holds when there is nothing to summarise. `audit_onpage` and `audit_schema` are untouched,
 *    and format-graph.test.ts carries the arithmetic that nothing else in the tech report moved.
 */
const SNAPSHOTS: Record<string, string> = {
  audit_onpage: [
    "On-page audit — 2 page(s) analyzed (crawl from 2026-08-14T00:00:00.000Z).",
    "",
    "Summary: 1 title too short, 1 missing meta description, 1 missing canonical, 1 thin content.",
    "2 page(s) with findings; 0 clean.",
    "",
    "Findings by page:",
    "- https://snap.example/",
    "    · missing meta description",
    "    · thin content (50 words, minimum 200)",
    "- https://snap.example/gone",
    "    · title too short (7 chars, minimum 10)",
    "    · missing canonical",
    // The snippet note (R-4.4), printed once at the foot because this fixture fires a
    // meta-description finding. It belongs in the frozen text: the note is customer copy, so
    // losing it should cost a deliberate edit here rather than pass unnoticed.
    "",
    "Note: Google generates most snippets from the page content itself and uses the meta " +
      "description only sometimes, so these are opportunities rather than errors.",
  ].join("\n"),
  audit_tech: [
    "Technical audit — 2 page(s), 1 skipped (crawl from 2026-08-14T00:00:00.000Z).",
    "",
    "HTTP status: 1 ok (2xx), 0 redirect (3xx), 1 client error (4xx), 0 server error (5xx).",
    "  4xx pages:",
    "  · https://snap.example/gone",
    "",
    "Redirects surfaced: 0",
    "",
    "Not crawled (skipped): 1",
    "  robots: 1",
    "    blocked by robots.txt — 1 URL(s):",
    "      · https://snap.example/private",
    "",
    "Robots conflicts (noindex but internally linked): 0",
    "",
    "Broken internal links (target crawled, answered 4xx/5xx): 1",
    "  · https://snap.example/ → https://snap.example/gone (404)",
  ].join("\n"),
  audit_schema: [
    "Structured-data audit — 2 page(s) (crawl from 2026-08-14T00:00:00.000Z).",
    "",
    "Coverage: 1 of 2 page(s) have JSON-LD; 1 have none.",
    "",
    "Types across the site:",
    "  · Organization: 1 page(s)",
    "",
    "Pages with NO structured data:",
    "  · https://snap.example/gone",
    "",
    "Note: detection is JSON-LD only (microdata/RDFa are not read); only @type names are " +
      "analyzed, never the JSON-LD body.",
  ].join("\n"),
};

describe("the returned text is byte-identical to what the audit returned before the write", () => {
  it.each(RENDERS)("$name", async ({ name, render }) => {
    const sink = recorder();

    const result = await toolFor(render, sink.writeRun).run(CTX, { project_id: PROJECT_ID });

    expect(result.content[0]?.text).toBe(`${SCOPE}\n\n${SNAPSHOTS[name]}`);
  });

  /**
   * The SECOND, independent statement of the same property, and the one that keeps the frozen
   * literals honest: the reply is still exactly `format<X>Report(audit<X>(crawl), fetchedAt)` —
   * the expression the tool evaluated before this slice, over engine and formatter modules this
   * slice does not touch. It also pins that the recorded report is the very one that was
   * rendered, so the row and the sentence are one measurement rather than two that agree today.
   */
  it.each([
    { name: "audit_onpage", render: renderOnpageAudit, before: () => FORMATTED.onpage },
    { name: "audit_tech", render: renderTechAudit, before: () => FORMATTED.tech },
    { name: "audit_schema", render: renderSchemaAudit, before: () => FORMATTED.schema },
  ])("$name returns the formatting of the exact report it recorded", async ({ render, before }) => {
    const sink = recorder();

    const result = await toolFor(render, sink.writeRun).run(CTX, { project_id: PROJECT_ID });

    expect(result.content[0]?.text).toBe(`${SCOPE}\n\n${before().text}`);
    expect(sink.runs[0]?.report).toEqual(before().report);
  });
});

/**
 * WHICH CRAWL WAS JUDGED — the fix for the hole measured live on 2026-09-02 (audit/load.ts states
 * it in full: a 30-credit audit read a one-page crawl that had displaced a 51-page one, and said
 * nothing about either). Three things have to hold, and each is a separate way to lose it:
 * the caller's `job_id` must REACH the loader, the scope sentence must come FIRST, and the
 * "you could have chosen" note must appear only when they did not choose.
 */
describe("every audit says which crawl it judged", () => {
  const CHOSEN = "12345678-aaaa-4bbb-8ccc-dddddddddddd";

  it.each(RENDERS)("$name opens with the scope sentence, before any finding", async ({ render }) => {
    const sink = recorder();

    const result = await toolFor(render, sink.writeRun).run(CTX, { project_id: PROJECT_ID });

    expect(result.content[0]?.text?.startsWith(SCOPE)).toBe(true);
  });

  it("passes the caller's job_id to the loader and audits THAT crawl", async () => {
    const seen: (string | undefined)[] = [];
    const sink = recorder();
    const tool = makeAuditTool("whats_next", "d", renderOnpageAudit, {
      loadCrawl: async (u, p, jobId) => {
        seen.push(jobId);
        return LOAD_OK(u, p, jobId);
      },
      loadProject: NO_PROJECT,
      writeRun: sink.writeRun,
      findPriorRun: NO_PRIOR_RUN,
    });

    const result = await tool.run(CTX, { project_id: PROJECT_ID, job_id: CHOSEN });

    expect(seen).toEqual([CHOSEN]);
    expect(result.content[0]?.text).toContain("Audited crawl 12345678 from 2026-08-14");
    // The row points at the crawl the caller named, not at whatever was newest.
    expect(sink.runs[0]?.target.crawlJobId).toBe(CHOSEN);
  });

  it("drops the 'pass job_id' note once the caller has passed one", async () => {
    const sink = recorder();

    const result = await toolFor(renderOnpageAudit, sink.writeRun).run(CTX, {
      project_id: PROJECT_ID,
      job_id: CHOSEN,
    });

    expect(result.content[0]?.text).not.toMatch(/list_jobs/);
    expect(result.content[0]?.text).not.toMatch(/most recent crawl/);
  });
});

/**
 * THE SECOND IDENTICAL AUDIT, measured live 2026-09-02 on all three priced audits: the same
 * project, the same `crawl_job_id`, seconds apart, BYTE-FOR-BYTE the same text, and a second
 * charge with no sentence anywhere saying the first one had happened.
 *
 * THE PRICE IS NOT TOUCHED — it is an operator-signed number and this slice does not have a
 * mandate over it. What was missing is the WARNING, and `audit_runs` has held the answer since
 * migration 0024: a row already keyed to this exact (tenant, project, crawl, tool).
 */
describe("re-auditing a crawl that was already audited says so", () => {
  const EARLIER = "2026-09-01T09:15:42.123456+00:00";

  function toolWithPrior(prior: string | null) {
    return makeAuditTool("whats_next", "d", renderOnpageAudit, {
      loadCrawl: LOAD_OK,
      loadProject: NO_PROJECT,
      writeRun: async () => {},
      findPriorRun: async () => prior,
    });
  }

  it("names the tool and when it ran, right under the scope sentence", async () => {
    const result = await toolWithPrior(EARLIER).run(CTX, { project_id: PROJECT_ID });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain(
      "Note: this crawl was already audited by whats_next on 2026-09-01 09:15 UTC. Re-running " +
        "produces the same report and is charged again.",
    );
    // Under the scope sentence, above the report: both lines are about the INPUT.
    expect(text.indexOf("already audited")).toBeGreaterThan(text.indexOf("Audited crawl"));
    expect(text.indexOf("already audited")).toBeLessThan(text.indexOf("On-page audit —"));
  });

  /**
   * THE LOOKUP RUNS BEFORE THE WRITE, and nothing else in this file can see it.
   *
   * Measured 2026-09-02: moving `findPriorRun` BELOW `writeRun` left the whole fast lane green at
   * 3820/3820. The ordering is not cosmetic — after the write, the row this very call just
   * inserted IS the row the lookup finds, so every FIRST audit of a crawl would answer "this crawl
   * was already audited by X on <the current minute>". The customer-visible failure is a warning
   * that is always on, which is a warning nobody reads.
   *
   * The two ports cannot catch it separately: each fake sees only its own invocation and both are
   * called exactly once either way. ONE SHARED LOG is what makes the sequence observable at all.
   */
  it("looks the prior run up BEFORE recording this one, so it cannot find itself", async () => {
    const calls: string[] = [];
    const tool = makeAuditTool("whats_next", "d", renderOnpageAudit, {
      loadCrawl: LOAD_OK,
      loadProject: NO_PROJECT,
      findPriorRun: async () => {
        calls.push("findPriorRun");
        return null;
      },
      writeRun: async () => {
        calls.push("writeRun");
      },
    });

    await tool.run(CTX, { project_id: PROJECT_ID });

    expect(calls).toEqual(["findPriorRun", "writeRun"]);
  });

  it("says nothing when this crawl has not been audited by this tool before", async () => {
    const result = await toolWithPrior(null).run(CTX, { project_id: PROJECT_ID });

    expect(result.content[0]?.text).not.toMatch(/already audited/i);
  });

  /**
   * THE LOOKUP IS KEYED TO THE CRAWL THAT WAS LOADED, not to the id the caller typed. They are the
   * same value on the happy path and this pins that they stay the same value: a lookup keyed to
   * the request would warn about a crawl the tool did not read.
   */
  it("asks about the crawl it actually loaded, under this tenant and tool", async () => {
    const asked: AuditRunTarget[] = [];
    const tool = makeAuditTool("whats_next", "d", renderOnpageAudit, {
      loadCrawl: LOAD_OK,
      loadProject: NO_PROJECT,
      writeRun: async () => {},
      findPriorRun: async (target) => {
        asked.push(target);
        return null;
      },
    });

    await tool.run(CTX, { project_id: PROJECT_ID });

    expect(asked).toEqual([
      {
        userId: CTX.userId,
        projectId: PROJECT_ID,
        crawlJobId: CRAWL_JOB_ID,
        tool: "whats_next",
      },
    ]);
  });
});

describe("a lost run is not a delivered audit", () => {
  /**
   * THE CALL SITE's half of fail-closed. `withCredits` commits a handler that RETURNS, so a
   * try/catch around the write — and nothing else — would charge for an audit the panel will
   * never show. The recorder rejects; the throw must reach the caller.
   */
  it("a recorder that throws is NOT swallowed — the tool call rejects", async () => {
    const tool = makeAuditTool("whats_next", "d", renderOnpageAudit, {
      loadCrawl: LOAD_OK,
      loadProject: NO_PROJECT,
      writeRun: async () => {
        throw new Error("audit_onpage: audit_runs write failed (simulated transport loss)");
      },
      findPriorRun: NO_PRIOR_RUN,
    });

    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(
      /audit_runs write failed/i,
    );
  });

  /**
   * A load with no job id has nowhere to point the row. Skipping the write there would be the
   * silent hole this whole slice exists to close, so it throws BEFORE the reply is built — and
   * `withCredits` releases, exactly as a refused audit does.
   */
  it("a crawl load with no job id refuses rather than recording nothing", async () => {
    const sink = recorder();
    const tool = makeAuditTool("whats_next", "d", renderOnpageAudit, {
      loadCrawl: async () => ({ ok: true as const, crawl: CRAWL }),
      loadProject: NO_PROJECT,
      writeRun: sink.writeRun,
      findPriorRun: NO_PRIOR_RUN,
    });

    await expect(tool.run(CTX, { project_id: PROJECT_ID })).rejects.toThrow(/job id/i);
    expect(sink.runs).toHaveLength(0);
  });

  /**
   * A builder whose render has no structural report to give records NOTHING — and must still
   * answer. The three priced audits all return a report (pinned above); this pins that the
   * text-only shape is a deliberate no-write rather than a crash.
   */
  it("a text-only audit records no run and still answers", async () => {
    const sink = recorder();

    const result = await toolFor((crawl) => `pages=${crawl.pages.length}`, sink.writeRun).run(CTX, {
      project_id: PROJECT_ID,
    });

    expect(result.content[0]?.text).toBe(`${SCOPE}\n\npages=2`);
    expect(sink.runs).toHaveLength(0);
  });
});
