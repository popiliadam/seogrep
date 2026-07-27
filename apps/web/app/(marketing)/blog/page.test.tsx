import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getPages = vi.fn();

vi.mock("../../../lib/source", () => ({
  blogSource: { getPages: () => getPages() },
}));

import BlogIndex from "./page";

afterEach(() => vi.clearAllMocks());

type PostFixture = { slug: string; title: string; description: string; date: string };

const page = ({ slug, title, description, date }: PostFixture) => ({
  slugs: [slug],
  url: `/blog/${slug}`,
  data: { title, description, date },
});

describe("blog index", () => {
  it("says so instead of rendering an empty list when no posts are published yet", () => {
    getPages.mockReturnValue([]);
    render(<BlogIndex />);
    expect(screen.getByText(/no posts yet\./i)).toBeDefined();
  });

  it("lists every post newest-first, whatever order the collection returns", () => {
    getPages.mockReturnValue([
      page({ slug: "older", title: "The older post", description: "Written first.", date: "2026-01-05" }),
      page({ slug: "newer", title: "The newer post", description: "Written second.", date: "2026-07-20" }),
    ]);
    render(<BlogIndex />);
    const titles = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(titles).toEqual(["The newer post", "The older post"]);
  });

  it("links each title to its post and shows the description and a formatted date", () => {
    getPages.mockReturnValue([
      page({ slug: "newer", title: "The newer post", description: "Written second.", date: "2026-07-20" }),
    ]);
    render(<BlogIndex />);
    expect(screen.getByRole("link", { name: "The newer post" }).getAttribute("href")).toBe("/blog/newer");
    expect(screen.getByText("Written second.")).toBeDefined();
    expect(screen.getByText("2026-07-20")).toBeDefined();
  });

  it("does not mutate the array the collection handed back", () => {
    const pages = [
      page({ slug: "older", title: "The older post", description: "Written first.", date: "2026-01-05" }),
      page({ slug: "newer", title: "The newer post", description: "Written second.", date: "2026-07-20" }),
    ];
    getPages.mockReturnValue(pages);
    render(<BlogIndex />);
    expect(pages.map((entry) => entry.slugs[0])).toEqual(["older", "newer"]);
  });
});
