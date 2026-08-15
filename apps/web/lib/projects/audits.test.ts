import { describe, expect, it } from "vitest";
import { AUDIT_TOOLS, buildAuditLines, type AuditRunRow } from "./audits";

/**
 * The audit lines a card shows. Three questions: is every audit listed (including the ones that
 * never ran), is the run shown the NEWEST one, and do the numbers come out of the report's
 * sub-fields without ever trusting their shape?
 *
 * Rows are written with the REAL column/alias names the query produces — a fixture in camelCase
 * would be more forgiving than PostgREST is.
 */

function row(overrides: Partial<AuditRunRow> & Pick<AuditRunRow, "tool" | "created_at">): AuditRunRow {
  return {
    page_count: null,
    finding_counts: null,
    status: null,
    pages_with_schema: null,
    ...overrides,
  };
}

const ONPAGE = row({
  tool: "audit_onpage",
  created_at: "2026-08-10T09:00:00.000Z",
  page_count: 12,
  finding_counts: { missing_meta_description: 3, thin_content: 2 },
});

const TECH = row({
  tool: "audit_tech",
  created_at: "2026-08-11T09:00:00.000Z",
  page_count: 12,
  status: { ok2xx: 9, redirect3xx: 0, clientError4xx: 2, serverError5xx: 1, other: 0 },
});

const SCHEMA = row({
  tool: "audit_schema",
  created_at: "2026-08-12T09:00:00.000Z",
  page_count: 12,
  pages_with_schema: 4,
});

describe("buildAuditLines — every audit gets a line", () => {
  it("lists all three tools in order even when none has ever run", () => {
    const lines = buildAuditLines([]);
    expect(lines.map((line) => line.tool)).toEqual([...AUDIT_TOOLS]);
    expect(lines.every((line) => line.run === null)).toBe(true);
  });

  /**
   * The absence is the actionable half: a card that dropped the tools with no runs would leave a
   * user who has never run audit_schema with nothing to notice.
   */
  it("keeps a null run for the audits that have not run, beside the ones that have", () => {
    const lines = buildAuditLines([ONPAGE]);
    expect(lines[0]?.run?.createdAt).toBe(ONPAGE.created_at);
    expect(lines[1]?.run).toBeNull();
    expect(lines[2]?.run).toBeNull();
  });

  it("ignores rows of some other tool entirely", () => {
    const lines = buildAuditLines([row({ tool: "crawl_site", created_at: "2026-08-13T09:00:00.000Z" })]);
    expect(lines.every((line) => line.run === null)).toBe(true);
  });
});

describe("buildAuditLines — the NEWEST run wins", () => {
  /**
   * The pin that a "latest" that quietly returns the oldest fails. The stale row is listed FIRST
   * and carries different numbers, so neither the date nor the summary can come from it by
   * accident.
   */
  it("shows this morning's run, not last month's", () => {
    const stale = row({
      tool: "audit_onpage",
      created_at: "2026-07-01T09:00:00.000Z",
      page_count: 4,
      finding_counts: { thin_content: 99 },
    });
    const fresh = row({
      tool: "audit_onpage",
      created_at: "2026-08-14T09:00:00.000Z",
      page_count: 12,
      finding_counts: { thin_content: 1 },
    });

    const [onpage] = buildAuditLines([stale, fresh]);

    expect(onpage?.run?.createdAt).toBe("2026-08-14T09:00:00.000Z");
    expect(onpage?.run?.summary).toBe("12 pages · 1 finding");
  });

  it("does not depend on the order the rows arrive in", () => {
    const older = row({ tool: "audit_tech", created_at: "2026-08-01T09:00:00.000Z", page_count: 1 });
    const newer = { ...TECH, created_at: "2026-08-13T09:00:00.000Z" };
    const ascending = buildAuditLines([older, newer])[1]?.run?.createdAt;
    const descending = buildAuditLines([newer, older])[1]?.run?.createdAt;
    expect(ascending).toBe("2026-08-13T09:00:00.000Z");
    expect(descending).toBe(ascending);
  });
});

describe("buildAuditLines — the numbers each audit shows", () => {
  it("on-page: pages crawled and how many findings fired", () => {
    expect(buildAuditLines([ONPAGE])[0]?.run?.summary).toBe("12 pages · 5 findings");
  });

  it("technical: pages crawled and how many answered 4xx or 5xx", () => {
    expect(buildAuditLines([TECH])[1]?.run?.summary).toBe("12 pages · 3 with a 4xx/5xx");
  });

  it("structured data: how many pages carry JSON-LD", () => {
    expect(buildAuditLines([SCHEMA])[2]?.run?.summary).toBe("4 of 12 pages carry JSON-LD");
  });

  /** English, not "1 pages" — the singular is the one a one-page site actually renders. */
  it("says page, not pages, for one", () => {
    const single = row({
      tool: "audit_onpage",
      created_at: "2026-08-14T09:00:00.000Z",
      page_count: 1,
      finding_counts: { thin_content: 1 },
    });
    expect(buildAuditLines([single])[0]?.run?.summary).toBe("1 page · 1 finding");
  });

  /** A clean audit is a delivered audit: zero findings is a NUMBER, never a missing summary. */
  it("summarizes a run that found nothing", () => {
    const clean = row({
      tool: "audit_onpage",
      created_at: "2026-08-14T09:00:00.000Z",
      page_count: 7,
      finding_counts: {},
    });
    expect(buildAuditLines([clean])[0]?.run?.summary).toBe("7 pages · 0 findings");
  });
});

describe("buildAuditLines — an unreadable report keeps the date and drops the numbers", () => {
  /**
   * `report` is a schemaless jsonb column. A null summary means "show that it ran, show no
   * numbers" — never "it never ran", and never a fabricated 0.
   */
  it.each([
    { what: "no pageCount", row: row({ tool: "audit_onpage", created_at: "2026-08-14T09:00:00.000Z" }) },
    {
      what: "a pageCount that is not a number",
      row: row({
        tool: "audit_onpage",
        created_at: "2026-08-14T09:00:00.000Z",
        page_count: "12",
        finding_counts: {},
      }),
    },
    {
      what: "counts that are not an object",
      row: row({
        tool: "audit_onpage",
        created_at: "2026-08-14T09:00:00.000Z",
        page_count: 12,
        finding_counts: ["thin_content"],
      }),
    },
  ])("$what: the run is still shown, with no summary", ({ row: unreadable }) => {
    const [onpage] = buildAuditLines([unreadable]);
    expect(onpage?.run).not.toBeNull();
    expect(onpage?.run?.createdAt).toBe("2026-08-14T09:00:00.000Z");
    expect(onpage?.run?.summary).toBeNull();
  });

  it("technical: a missing status block drops the numbers rather than reporting 0 errors", () => {
    const noStatus = row({ tool: "audit_tech", created_at: "2026-08-14T09:00:00.000Z", page_count: 12 });
    expect(buildAuditLines([noStatus])[1]?.run?.summary).toBeNull();
  });

  it("structured data: a missing pagesWithSchema drops the numbers rather than reporting 0", () => {
    const noCoverage = row({
      tool: "audit_schema",
      created_at: "2026-08-14T09:00:00.000Z",
      page_count: 12,
    });
    expect(buildAuditLines([noCoverage])[2]?.run?.summary).toBeNull();
  });
});
