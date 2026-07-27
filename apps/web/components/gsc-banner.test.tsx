import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GscBanner } from "./gsc-banner";

/**
 * The seven states /api/gsc/{connect,callback} can redirect back to /app with. The copy is
 * pinned verbatim here: these strings are the only thing a returning user sees about a link
 * attempt, so a silent reword is a regression, not a refactor.
 */
describe("GscBanner", () => {
  it("error: tells the user the link failed and to retry", () => {
    render(<GscBanner status="error" />);
    expect(
      screen.getByText("Something went wrong connecting Search Console. Please try again."),
    ).toBeTruthy();
  });

  it("denied: names the declined consent and offers a retry", () => {
    render(<GscBanner status="denied" />);
    expect(
      screen.getByText("You declined Google access. You can reconnect any time."),
    ).toBeTruthy();
  });

  it("unknown_project: says the project was not found", () => {
    render(<GscBanner status="unknown_project" />);
    expect(screen.getByText("That project was not found in your account.")).toBeTruthy();
  });

  it("no_token: says Google returned no token", () => {
    render(<GscBanner status="no_token" />);
    expect(
      screen.getByText("Google did not return a token. Please try connecting again."),
    ).toBeTruthy();
  });

  it("connected + matched property: plain success", () => {
    render(<GscBanner status="connected" property="matched" />);
    expect(screen.getByText("Search Console connected.")).toBeTruthy();
  });

  it("connected + no matched property: connected, but names the missing verification", () => {
    render(<GscBanner status="connected" property="none" />);
    expect(
      screen.getByText(
        "Search Console connected, but no verified property matches this domain yet. Verify the domain in Search Console, then pull data.",
      ),
    ).toBeTruthy();
  });

  it("connected with NO property param falls back to the unmatched wording (never claims a match)", () => {
    render(<GscBanner status="connected" />);
    expect(
      screen.getByText(
        "Search Console connected, but no verified property matches this domain yet. Verify the domain in Search Console, then pull data.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Search Console connected.")).toBeNull();
  });

  it("connected with an unrecognised property value also falls back to the unmatched wording", () => {
    render(<GscBanner status="connected" property="whatever" />);
    expect(screen.queryByText("Search Console connected.")).toBeNull();
    expect(screen.getByText(/no verified property matches this domain yet/)).toBeTruthy();
  });

  it("no status: renders nothing", () => {
    const { container } = render(<GscBanner />);
    expect(container.textContent).toBe("");
  });

  it("an unknown status renders nothing (a crafted ?gsc= value is never reflected)", () => {
    const { container } = render(<GscBanner status="totally-made-up" />);
    expect(container.textContent).toBe("");
  });

  it("an inherited Object key as status renders nothing", () => {
    // "constructor"/"toString" must not resolve through a prototype into a rendered banner.
    const { container } = render(<GscBanner status="constructor" />);
    expect(container.textContent).toBe("");
  });

  it("the raw status value is never echoed into the page", () => {
    const { container } = render(<GscBanner status="<script>alert(1)</script>" />);
    expect(container.textContent).toBe("");
  });
});
