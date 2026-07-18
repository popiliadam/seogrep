import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const getBalance = vi.fn();
const listLedgerEntries = vi.fn();

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@pseo/db/ledger-read", () => ({
  getBalance: (...args: unknown[]) => getBalance(...args),
  listLedgerEntries: (...args: unknown[]) => listLedgerEntries(...args),
}));

import OverviewPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

async function renderPage() {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  render(await OverviewPage());
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
});
