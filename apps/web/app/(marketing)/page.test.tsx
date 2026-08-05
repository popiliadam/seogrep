import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "./page";

describe("landing page", () => {
  it("renders the brand h1 without placeholder text", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("grep your site for SEO issues.");
  });

  it("labels the chat demo as illustrative", () => {
    render(<Page />);
    expect(screen.getByText(/illustrative example — sample site, sample numbers/i)).toBeDefined();
  });

  // Replaces "has the waitlist section anchor". The gate is gone, so what has to hold now is
  // that the page actually offers a way IN — both CTAs land on /signup, and no dead #waitlist
  // anchor survives to scroll a visitor to nothing.
  it("routes both calls to action to /signup", () => {
    render(<Page />);
    const cta = screen.getAllByRole("link", { name: /get started free/i });
    expect(cta.length).toBe(2);
    for (const link of cta) expect(link.getAttribute("href")).toBe("/signup");
  });

  it("leaves no waitlist anchor behind", () => {
    render(<Page />);
    expect(document.getElementById("waitlist")).toBeNull();
  });

  it("mentions the real trial terms only", () => {
    render(<Page />);
    expect(screen.getByText(/200 credits, no card required/i)).toBeDefined();
  });

  // L-09: this line read "Free trial AT LAUNCH", which checkout going live made false — the trial
  // is grantable today. Signup is now open self-serve, so the line is finally unqualified: there
  // is no gate left between reading it and claiming it.
  it("does not defer the trial to a future launch", () => {
    render(<Page />);
    expect(screen.getByText(/200 credits, no card required/i).textContent).not.toMatch(/at launch/i);
  });

  it("emits valid SoftwareApplication JSON-LD (audit G2: was 0/42 pages)", () => {
    const { container } = render(<Page />);
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const blocks = scripts.map((s) => JSON.parse(s.textContent ?? "{}"));
    const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
    expect(app, "SoftwareApplication JSON-LD present").toBeDefined();
    expect(app["@context"]).toBe("https://schema.org");
    expect(app.name).toBe("SeoGrep");
  });
});
