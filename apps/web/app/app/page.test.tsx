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

/**
 * The counts the page reads, PER TABLE. It was one number for every table until Overview began
 * counting expired Google accounts too; a single shared answer would have made the reconnection
 * line appear on the strength of the PROJECT count, which is not a thing the page does.
 */
async function renderPage(
  params: Params = {},
  activeProjects: number | null = 0,
  expiredAccounts: number | null = 0,
) {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  projectCount.mockImplementation((table: string) =>
    table === "gsc_accounts"
      ? { count: expiredAccounts, error: null }
      : { count: activeProjects, error: null },
  );
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

  /**
   * THE RECONNECTION LINE. A revoked Google grant used to be invisible everywhere the user
   * actually looks: it lived in `gsc_accounts.token_status`, was read by three MCP tools, and
   * surfaced on the dashboard only as a paid tool failing. Overview is where a user lands, so it
   * is where the fact belongs — but ONLY as a fact, never as a permanent slot.
   */
  describe("Google accounts that need reconnecting", () => {
    function emptyLedger() {
      getBalance.mockResolvedValue(0);
      listLedgerEntries.mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 5 });
    }

    it("renders NOTHING when no account is expired", async () => {
      emptyLedger();
      await renderPage({}, 2, 0);

      // Not "0 accounts need reconnection" — a row that is always there is a row the eye learns
      // to skip on the day it matters.
      expect(screen.queryByText(/reconnect/i)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("names one expired account and leads to the page that fixes it", async () => {
      emptyLedger();
      await renderPage({}, 2, 1);

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/1 google account needs reconnection/i);
      // The trailing clause agrees with the count as well.
      expect(alert.textContent).toMatch(/until it is reconnected/i);
      expect(screen.getByText("Open Connection").getAttribute("href")).toBe("/app/connection");
    });

    it("counts several, and says so in the plural THROUGHOUT", async () => {
      emptyLedger();
      await renderPage({}, 2, 3);

      const alert = screen.getByRole("alert").textContent ?? "";
      expect(alert).toMatch(/3 google accounts need reconnection/i);
      // "…until it is reconnected" after "3 Google accounts" reads as though one of the three
      // is the problem, which is the opposite of what the count just said.
      expect(alert).toMatch(/until they are reconnected/i);
      expect(alert).not.toMatch(/until it is reconnected/i);
    });

    it("reads the count off gsc_accounts, not off the projects count", async () => {
      // The two numbers differ on purpose: a shared answer would have made this line appear
      // because the user has projects, which is not a thing the page claims.
      emptyLedger();
      await renderPage({}, 7, 0);

      expect(projectCount).toHaveBeenCalledWith("gsc_accounts");
      expect(screen.queryByText(/reconnection/i)).toBeNull();
    });

    it("a failed health count says nothing rather than inventing an outage", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      emptyLedger();
      getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
      projectCount.mockImplementation((table: string) =>
        table === "gsc_accounts"
          ? { count: null, error: { message: "boom" } }
          : { count: 1, error: null },
      );
      render(await OverviewPage({ searchParams: Promise.resolve({}) }));

      expect(screen.queryByText(/reconnection/i)).toBeNull();
      // The rest of the page is untouched — the balance is what Overview is FOR.
      expect(screen.getByText(/You are tracking 1 project\./)).toBeTruthy();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
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
