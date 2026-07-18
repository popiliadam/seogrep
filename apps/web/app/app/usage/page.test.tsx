import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listLedgerEntries = vi.fn();

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("@pseo/db/ledger-read", () => ({
  listLedgerEntries: (...args: unknown[]) => listLedgerEntries(...args),
}));

import UsagePage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

function makeEntries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    delta: i % 2 === 0 ? i + 1 : -(i + 1),
    kind: i % 2 === 0 ? "grant" : "spend_reserve",
    reason: null,
    tool: "audit",
  }));
}

async function renderUsage(pageParam: string | undefined, result: unknown) {
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  listLedgerEntries.mockResolvedValue(result);
  const searchParams = Promise.resolve(pageParam === undefined ? {} : { page: pageParam });
  render(await UsagePage({ searchParams }));
}

describe("UsagePage", () => {
  it("first page: Previous is disabled, Next links to page 2, badges + total shown", async () => {
    await renderUsage("1", { entries: makeEntries(25), total: 60, page: 1, pageSize: 25 });

    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.getByText("Previous").getAttribute("aria-disabled")).toBe("true");

    const next = screen.getByRole("link", { name: "Next" });
    expect(next.getAttribute("href")).toBe("/app/usage?page=2");

    expect(screen.getByText(/60 entries/)).toBeTruthy();
    expect(screen.getAllByText("grant").length).toBeGreaterThan(0);

    expect(listLedgerEntries).toHaveBeenCalledWith(expect.anything(), "user-1", {
      page: 1,
      pageSize: 25,
    });
  });

  it("last page: Next is disabled, Previous links to the prior page", async () => {
    await renderUsage("3", { entries: makeEntries(10), total: 60, page: 3, pageSize: 25 });

    const prev = screen.getByRole("link", { name: "Previous" });
    expect(prev.getAttribute("href")).toBe("/app/usage?page=2");

    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
    expect(screen.getByText("Next").getAttribute("aria-disabled")).toBe("true");
  });

  it("normalizes an invalid page param to 1", async () => {
    await renderUsage("not-a-number", { entries: makeEntries(3), total: 3, page: 1, pageSize: 25 });
    expect(listLedgerEntries).toHaveBeenCalledWith(expect.anything(), "user-1", {
      page: 1,
      pageSize: 25,
    });
  });

  it("overflowing page renders the served (clamped) page without erroring", async () => {
    // The repo clamps ?page=1000 on a 3-row ledger to page 1 and reports it back; the
    // pager must reflect the SERVED page, not the requested one.
    await renderUsage("1000", { entries: makeEntries(3), total: 3, page: 1, pageSize: 25 });
    expect(listLedgerEntries).toHaveBeenCalledWith(expect.anything(), "user-1", {
      page: 1000,
      pageSize: 25,
    });
    expect(screen.getByText(/3 entries · Page 1 of 1/)).toBeTruthy();
    // Single real page: both controls render disabled.
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("empty ledger shows the empty state and no pager", async () => {
    await renderUsage(undefined, { entries: [], total: 0, page: 1, pageSize: 25 });
    expect(screen.getByText("No activity yet.")).toBeTruthy();
    expect(screen.queryByText("Previous")).toBeNull();
    expect(screen.queryByText("Next")).toBeNull();
  });
});
