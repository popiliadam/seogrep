import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RevokeLinkButton } from "./revoke-link-button";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function props(overrides: Partial<Parameters<typeof RevokeLinkButton>[0]> = {}) {
  return {
    reportId: REPORT_ID,
    title: "Q3 SEO Report",
    revokeReportLinkAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const clickRevoke = () =>
  fireEvent.click(screen.getByRole("button", { name: /revoke the public link for q3 seo report/i }));

describe("RevokeLinkButton", () => {
  it("calls revokeReportLinkAction(reportId) and refreshes so the row re-renders from the DB", async () => {
    const p = props();
    render(<RevokeLinkButton {...p} />);

    clickRevoke();

    await waitFor(() => expect(p.revokeReportLinkAction).toHaveBeenCalledWith(REPORT_ID));
    // The refresh is what drops the View link from the row: this island never fakes that state.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces an error (role=alert) and does NOT refresh when the action rejects", async () => {
    // A failed revoke must never look like a successful one — the link is still live.
    const p = props({ revokeReportLinkAction: vi.fn().mockRejectedValue(new Error("boom")) });
    render(<RevokeLinkButton {...p} />);

    clickRevoke();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never claims the report was deleted — it only speaks about the link", async () => {
    render(<RevokeLinkButton {...props()} />);
    const rendered = screen.getByRole("button").parentElement?.textContent ?? "";
    expect(rendered).not.toMatch(/delete/i);
    expect(screen.getByRole("button", { name: /public link/i })).toBeTruthy();
  });
});
