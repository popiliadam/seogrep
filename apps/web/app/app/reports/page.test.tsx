import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listReports = vi.fn();

vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../../../lib/reports", () => ({
  listReports: (...args: unknown[]) => listReports(...args),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import ReportsPage from "./page";

afterEach(() => vi.clearAllMocks());

describe("ReportsPage", () => {
  it("lists the caller's reports with a link to the public page", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    listReports.mockResolvedValue([
      { id: "r1", title: "Q3 SEO Report", createdAt: "2026-07-19T00:00:00.000Z", publicSlug: "abc123" },
    ]);
    render(await ReportsPage());

    expect(screen.getByText("Q3 SEO Report")).toBeTruthy();
    expect(screen.getByText("2026-07-19")).toBeTruthy();
    const link = screen.getByText("View");
    expect(link.getAttribute("href")).toBe("/r/abc123");
    // Reads through the caller's authenticated client, scoped to their id.
    expect(listReports).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("shows an empty state when there are no reports", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    listReports.mockResolvedValue([]);
    render(await ReportsPage());
    expect(screen.getByText(/No reports yet/)).toBeTruthy();
  });

  it("prompts sign-in and does not read reports when there is no user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    render(await ReportsPage());
    expect(screen.getByText("Sign in to view your reports.")).toBeTruthy();
    expect(listReports).not.toHaveBeenCalled();
  });
});
