import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("links Sign in to the live login route (audit G3)", () => {
    render(<SiteHeader />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn.getAttribute("href")).toBe("/login");
  });

  it("points the primary CTA at self-serve signup", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /get started/i }).getAttribute("href")).toBe("/signup");
  });

  it("puts Blog in the main nav", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /^blog$/i }).getAttribute("href")).toBe("/blog");
  });
});
