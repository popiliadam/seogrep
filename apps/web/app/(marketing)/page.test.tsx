import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "./page";

describe("landing page", () => {
  it("renders the brand h1 without placeholder text", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Point a lens at your site.");
  });

  it("labels the chat demo as illustrative", () => {
    render(<Page />);
    expect(screen.getByText(/illustrative example — sample site, sample numbers/i)).toBeDefined();
  });

  it("has the waitlist section anchor", () => {
    render(<Page />);
    expect(document.getElementById("waitlist")).not.toBeNull();
  });

  it("mentions the real trial terms only", () => {
    render(<Page />);
    expect(screen.getByText(/200 credits, no card required/i)).toBeDefined();
  });
});
