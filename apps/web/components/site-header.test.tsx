import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("links Sign in to the live login route (audit G3)", () => {
    render(<SiteHeader />);
    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn.getAttribute("href")).toBe("/login");
  });

  it("keeps the Join waitlist CTA", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /join waitlist/i }).getAttribute("href")).toBe("/#waitlist");
  });
});
