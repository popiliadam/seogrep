import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchPublicReportBySlug = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("../../../lib/reports", () => ({
  fetchPublicReportBySlug: (...args: unknown[]) => fetchPublicReportBySlug(...args),
}));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

import PublicReportPage, { generateMetadata } from "./page";

afterEach(() => vi.clearAllMocks());

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("PublicReportPage", () => {
  it("renders the stored report html verbatim for a valid slug", async () => {
    fetchPublicReportBySlug.mockResolvedValue({ title: "Shared", html: "<main id=\"rpt\">hello</main>" });
    const { container } = render(await PublicReportPage(params("abc")));
    expect(container.querySelector("#rpt")).toBeTruthy();
    expect(container.innerHTML).toContain("hello");
    expect(fetchPublicReportBySlug).toHaveBeenCalledWith("abc");
  });

  it("calls notFound() when the slug matches nothing", async () => {
    fetchPublicReportBySlug.mockResolvedValue(null);
    await expect(PublicReportPage(params("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});

describe("generateMetadata", () => {
  it("uses the report title and marks the page noindex", async () => {
    fetchPublicReportBySlug.mockResolvedValue({ title: "Shared", html: "<main>hi</main>" });
    const meta = await generateMetadata(params("abc"));
    expect(meta.title).toBe("Shared");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("falls back to a not-found title (still noindex) when the slug matches nothing", async () => {
    fetchPublicReportBySlug.mockResolvedValue(null);
    const meta = await generateMetadata(params("missing"));
    expect(meta.title).toBe("Report not found");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
