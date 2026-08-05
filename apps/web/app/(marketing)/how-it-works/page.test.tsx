import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "./page";

/**
 * Added because a referee found this page in the same unpinned state as pricing-table: its CTA
 * was repointed from /#waitlist to /signup and nothing held it there, so a revert would pass
 * every gate. This page is the worse of the two to get wrong — its step 1 used to read "When
 * your invite arrives" directly above a "Get started free" button, which is how the stale copy
 * survived a whole review round.
 */
describe("how-it-works page", () => {
  it("routes its call to action at self-serve signup", () => {
    render(<Page />);
    expect(screen.getByRole("link", { name: /get started free/i }).getAttribute("href")).toBe(
      "/signup",
    );
  });

  it("leaves no link pointing at the removed waitlist", () => {
    const { container } = render(<Page />);
    expect(container.querySelector('a[href*="waitlist"]')).toBeNull();
  });

  // The gate copy, not just the gate link. Both phrasings were live on this page after the
  // first pass.
  it("does not tell a self-serve visitor to wait for an invite", () => {
    render(<Page />);
    expect(document.body.textContent).not.toMatch(/your invite|private beta|waitlist/i);
  });
});
