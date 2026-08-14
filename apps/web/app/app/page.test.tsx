import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getBalance = vi.fn();
const listLedgerEntries = vi.fn();
/** What Overview's `projects` head-count answers with — see `countProjects` below. */
const projectCount = vi.fn();

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    /**
     * Overview reads ONE table directly: a head-only count of the caller's active projects.
     * The stand-in records the table and is chainable through `.eq()` / `.is()` so a dropped
     * filter still reaches the same resolution — WHICH filters the page applies is pinned as
     * source in overview-projects.test.ts, since a chainable double can never notice a missing
     * one (signed lesson 12).
     */
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          is: () => chain,
          then: (resolve: (value: unknown) => unknown) => resolve(projectCount(table)),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("@pseo/db/ledger-read", () => ({
  getBalance: (...args: unknown[]) => getBalance(...args),
  listLedgerEntries: (...args: unknown[]) => listLedgerEntries(...args),
}));

import OverviewPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

type Params = Record<string, string | string[] | undefined>;

async function renderPage(params: Params = {}, activeProjects: number | null = 0) {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  projectCount.mockReturnValue({ count: activeProjects, error: null });
  render(await OverviewPage({ searchParams: Promise.resolve(params) }));
}

describe("OverviewPage", () => {
  it("shows the balance and the last five ledger entries", async () => {
    getBalance.mockResolvedValue(1234);
    listLedgerEntries.mockResolvedValue({
      entries: [
        { id: 3, createdAt: "2026-07-03T00:00:00.000Z", delta: 200, kind: "grant", reason: "trial", tool: null },
        { id: 2, createdAt: "2026-07-02T00:00:00.000Z", delta: -50, kind: "spend_reserve", reason: null, tool: "audit" },
        { id: 1, createdAt: "2026-07-01T00:00:00.000Z", delta: 0, kind: "spend_commit", reason: null, tool: "audit" },
      ],
      total: 3,
      page: 1,
      pageSize: 5,
    });
    await renderPage();

    expect(screen.getByText("1,234")).toBeTruthy();
    expect(screen.getByText("+200")).toBeTruthy();
    expect(screen.getByText("-50")).toBeTruthy();
    expect(screen.getByText("commit")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    // Overview asks for exactly the latest five.
    expect(listLedgerEntries).toHaveBeenCalledWith(expect.anything(), "user-1", {
      page: 1,
      pageSize: 5,
    });
  });

  it("shows an empty state when there is no activity", async () => {
    getBalance.mockResolvedValue(0);
    listLedgerEntries.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 5 });
    await renderPage();

    expect(screen.getByText("No activity yet.")).toBeTruthy();
  });

  /**
   * The projects line. Overview names how many sites the account tracks and links onward; the
   * wording itself belongs to `lib/projects/count-line` (and is executed by its own spec), so
   * what these two add is that the page RENDERS it, from the count it read, with the link.
   */
  describe("the projects line", () => {
    function emptyLedger() {
      getBalance.mockResolvedValue(0);
      listLedgerEntries.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 5 });
    }

    it("says nothing is tracked yet when the count is zero", async () => {
      emptyLedger();
      await renderPage({}, 0);

      expect(screen.getByText(/No projects yet\./)).toBeTruthy();
      expect(projectCount).toHaveBeenCalledWith("projects");
      expect(screen.getByText("View projects").getAttribute("href")).toBe("/app/projects");
    });

    it("names the number of tracked sites when there are some", async () => {
      emptyLedger();
      await renderPage({}, 4);

      expect(screen.getByText(/You are tracking 4 projects\./)).toBeTruthy();
      expect(screen.getByText("View projects").getAttribute("href")).toBe("/app/projects");
    });
  });

  // The GSC OAuth routes redirect back here with ?gsc=… (and ?property=… on success).
  // Overview is the only page that reads them.
  describe("Search Console return status", () => {
    function emptyLedger() {
      getBalance.mockResolvedValue(0);
      listLedgerEntries.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 5 });
    }

    it("?gsc=connected&property=matched renders the success copy", async () => {
      emptyLedger();
      await renderPage({ gsc: "connected", property: "matched" });
      expect(screen.getByText("Search Console connected.")).toBeTruthy();
    });

    it("?gsc=error renders the failure copy", async () => {
      emptyLedger();
      await renderPage({ gsc: "error" });
      expect(
        screen.getByText("Something went wrong connecting Search Console. Please try again."),
      ).toBeTruthy();
    });

    it("repeated params are normalized to the first value", async () => {
      emptyLedger();
      await renderPage({ gsc: ["connected", "error"], property: ["matched", "none"] });
      expect(screen.getByText("Search Console connected.")).toBeTruthy();
    });

    it("no params: no banner at all", async () => {
      emptyLedger();
      await renderPage();
      expect(screen.queryByText(/Search Console/)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
