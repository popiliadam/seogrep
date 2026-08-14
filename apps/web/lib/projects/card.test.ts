import { describe, expect, it } from "vitest";
import { buildProjectCard, buildProjectCards } from "./card";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function ago(days: number): string {
  return new Date(NOW.getTime() - days * MS_PER_DAY).toISOString();
}

const PROJECT = { id: "p-1", domain: "example.com", created_at: "2026-01-02T00:00:00.000Z" };

/** A crawl_site result shaped as the engine actually stores it (pages[] / skipped[]). */
const CRAWL_RESULT = {
  pages: [{ url: "https://example.com/", issues: ["missing-title"] }, { url: "https://example.com/a", issues: [] }],
  skipped: [],
};

describe("buildProjectCard", () => {
  it("carries the project's identity and created date through unchanged", () => {
    const card = buildProjectCard({ project: PROJECT, crawl: null, pull: null, connection: null }, NOW);
    expect(card.projectId).toBe("p-1");
    expect(card.domain).toBe("example.com");
    expect(card.createdAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("reports no crawl and no pull for an untouched project", () => {
    const card = buildProjectCard({ project: PROJECT, crawl: null, pull: null, connection: null }, NOW);
    expect(card.crawl).toBeNull();
    expect(card.pullAt).toBeNull();
  });

  // The summary is core's `summarizeCrawlResult`, so the panel and `get_job_status` describe the
  // same crawl in the same words.
  it("summarizes a stored crawl result with core's summary", () => {
    const card = buildProjectCard(
      { project: PROJECT, crawl: { created_at: ago(3), result: CRAWL_RESULT }, pull: null, connection: null },
      NOW,
    );
    expect(card.crawl?.createdAt).toBe(ago(3));
    expect(card.crawl?.summary).toBe("Crawled 2 page(s), skipped 0, 1 issue(s) found");
  });

  // Defensive by design: jobs.result is jsonb of unknown shape. A null summary means "show the
  // date, show no summary line" — never "there was no crawl".
  it("keeps the crawl date but drops the summary when the result is not crawl-shaped", () => {
    const card = buildProjectCard(
      { project: PROJECT, crawl: { created_at: ago(3), result: { something: "else" } }, pull: null, connection: null },
      NOW,
    );
    expect(card.crawl?.createdAt).toBe(ago(3));
    expect(card.crawl?.summary).toBeNull();
  });

  it("reports the last successful pull date", () => {
    const card = buildProjectCard(
      { project: PROJECT, crawl: null, pull: { created_at: ago(5), result: null }, connection: null },
      NOW,
    );
    expect(card.pullAt).toBe(ago(5));
  });
});

describe("buildProjectCard — the Search Console status", () => {
  it("is not_connected when the project has no gsc_connections row", () => {
    const card = buildProjectCard({ project: PROJECT, crawl: null, pull: null, connection: null }, NOW);
    expect(card.gsc).toEqual({ kind: "not_connected" });
  });

  // Defect #52 at the CARD level: the row exists, so a page keying on row existence would show
  // "Connected" for a project whose token was disconnected and which reads nothing.
  it("is not_connected when a row exists with a null account_id", () => {
    const card = buildProjectCard(
      {
        project: PROJECT,
        crawl: null,
        pull: null,
        connection: { account_id: null, gsc_property: "https://example.com/" },
      },
      NOW,
    );
    expect(card.gsc).toEqual({ kind: "not_connected" });
  });

  it("is connected with a null property when an account is linked but nothing is matched yet", () => {
    const card = buildProjectCard(
      { project: PROJECT, crawl: null, pull: null, connection: { account_id: "acct-1", gsc_property: null } },
      NOW,
    );
    expect(card.gsc).toEqual({ kind: "connected", property: null });
  });

  it("is connected with the property when one is mapped", () => {
    const card = buildProjectCard(
      {
        project: PROJECT,
        crawl: null,
        pull: null,
        connection: { account_id: "acct-1", gsc_property: "sc-domain:example.com" },
      },
      NOW,
    );
    expect(card.gsc).toEqual({ kind: "connected", property: "sc-domain:example.com" });
  });
});

describe("buildProjectCards", () => {
  it("preserves the caller's order (oldest first, as list_projects sorts)", () => {
    const cards = buildProjectCards(
      [
        { project: { ...PROJECT, id: "old", domain: "old.example" }, crawl: null, pull: null, connection: null },
        { project: { ...PROJECT, id: "new", domain: "new.example" }, crawl: null, pull: null, connection: null },
      ],
      NOW,
    );
    expect(cards.map((card) => card.domain)).toEqual(["old.example", "new.example"]);
  });
});
