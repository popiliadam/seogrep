import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getPage = vi.fn();
const getPages = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("../../../../lib/source", () => ({
  blogSource: { getPage: (...args: unknown[]) => getPage(...args), getPages: () => getPages() },
}));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

import BlogPostPage, { generateMetadata, generateStaticParams } from "./page";

afterEach(() => vi.clearAllMocks());

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

const post = {
  slugs: ["first-post"],
  url: "/blog/first-post",
  data: {
    title: "The first post",
    description: "What SeoGrep shipped this week.",
    date: "2026-07-20",
    body: () => <p>Body of the first post.</p>,
  },
};

describe("blog post page", () => {
  it("renders the post title, date and MDX body", async () => {
    getPage.mockReturnValue(post);
    render(await BlogPostPage(params("first-post")));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("The first post");
    expect(screen.getByText("2026-07-20")).toBeDefined();
    expect(screen.getByText("Body of the first post.")).toBeDefined();
    expect(getPage).toHaveBeenCalledWith(["first-post"]);
  });

  it("calls notFound() for a slug that matches no post", async () => {
    getPage.mockReturnValue(undefined);
    await expect(BlogPostPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});

describe("blog post metadata", () => {
  it("uses the post's own title and description", async () => {
    getPage.mockReturnValue(post);
    const meta = await generateMetadata(params("first-post"));
    expect(meta.title).toBe("The first post");
    expect(meta.description).toBe("What SeoGrep shipped this week.");
  });

  it("calls notFound() for an unknown slug", async () => {
    getPage.mockReturnValue(undefined);
    await expect(generateMetadata(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("blog post static params", () => {
  it("prerenders one single-segment param per published post", () => {
    getPages.mockReturnValue([post, { ...post, slugs: ["second-post"], url: "/blog/second-post" }]);
    expect(generateStaticParams()).toEqual([{ slug: "first-post" }, { slug: "second-post" }]);
  });

  it("returns nothing while the collection is empty", () => {
    getPages.mockReturnValue([]);
    expect(generateStaticParams()).toEqual([]);
  });
});
