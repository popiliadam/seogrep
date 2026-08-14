import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AddDomainBanner } from "./add-domain-banner";
import { addedUrl, errorUrl } from "./add-domain-contract";

/**
 * THE REDIRECT CONTRACT, from both ends: the URLs the action builds, and what the page renders
 * when it is reached through them. They are asserted TOGETHER — the banner is fed the params
 * parsed out of the action's own URL rather than hand-written strings, so a renamed code cannot
 * leave one side green while the other renders nothing.
 *
 * The copy is pinned verbatim: these sentences are the only thing a user sees about what the
 * form did, so a silent reword is a regression, not a refactor.
 */

/** Read a redirect URL the way the page does: `searchParams`, first value only. */
function paramsOf(url: string): { added?: string; domain?: string; error?: string } {
  const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  return {
    added: query.get("added") ?? undefined,
    domain: query.get("domain") ?? undefined,
    error: query.get("error") ?? undefined,
  };
}

describe("the four branches the Add-domain action can redirect with", () => {
  it("created: names the site as now tracked", () => {
    render(<AddDomainBanner {...paramsOf(addedUrl("created", "example.com"))} />);
    expect(screen.getByText("Now tracking example.com.")).toBeTruthy();
  });

  it("existing: says the site was already on the list", () => {
    render(<AddDomainBanner {...paramsOf(addedUrl("existing", "example.com"))} />);
    expect(screen.getByText("You were already tracking example.com.")).toBeTruthy();
  });

  it("restored: names the archive it came back from", () => {
    render(<AddDomainBanner {...paramsOf(addedUrl("restored", "example.com"))} />);
    expect(screen.getByText("example.com is back — restored from your archive.")).toBeTruthy();
  });

  it("error: gives the refusal a literal sentence and an alert role", () => {
    render(<AddDomainBanner {...paramsOf(errorUrl("invalid_domain"))} />);
    const message = screen.getByRole("alert");
    expect(message.textContent).toMatch(/not a domain SeoGrep can track/i);
    expect(message.textContent).toMatch(/\.internal, \.local, \.test/);
  });

  it("error: the two other refusal codes each say something different", () => {
    const { unmount } = render(<AddDomainBanner {...paramsOf(errorUrl("not_restored"))} />);
    expect(screen.getByRole("alert").textContent).toMatch(/still in your archive/i);
    unmount();

    render(<AddDomainBanner {...paramsOf(errorUrl("failed"))} />);
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not add that domain. Please try again.",
    );
  });

  /** A percent-encoded domain arrives decoded, and is named as itself. */
  it("survives the encoding round trip for a domain that needed escaping", () => {
    render(<AddDomainBanner {...paramsOf(addedUrl("created", "xn--80ak6aa92e.com"))} />);
    expect(screen.getByText("Now tracking xn--80ak6aa92e.com.")).toBeTruthy();
  });
});

/**
 * The query string is reachable by anyone who can get the user to follow a link, so the page
 * treats it as hostile input: unknown values render NOTHING rather than being repeated back.
 */
describe("nothing off the query string is echoed", () => {
  it("renders nothing at all without a status", () => {
    const { container } = render(<AddDomainBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for an unknown added / error value", () => {
    for (const props of [
      { added: "deleted" },
      { added: "<script>alert(1)</script>" },
      { error: "you have been hacked, call this number" },
      { error: "" },
      { added: "" },
    ]) {
      const { container, unmount } = render(<AddDomainBanner {...props} />);
      expect(container.innerHTML, `${JSON.stringify(props)} produced output`).toBe("");
      unmount();
    }
  });

  /**
   * `constructor` / `toString` resolve on a plain object's prototype but not on a Map — the
   * reason both lookups are Maps. Without that, `?added=constructor` renders a function body.
   */
  it("renders nothing for inherited Object keys", () => {
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const added = render(<AddDomainBanner added={key} />);
      expect(added.container.innerHTML, `?added=${key} produced output`).toBe("");
      added.unmount();

      const failed = render(<AddDomainBanner error={key} />);
      expect(failed.container.innerHTML, `?error=${key} produced output`).toBe("");
      failed.unmount();
    }
  });

  /**
   * A KNOWN outcome with an arbitrary `domain` still renders — the outcome is real — but the
   * sentence falls back to the domain-less wording rather than repeating the string.
   */
  it("does not repeat a domain param that is not domain-shaped", () => {
    for (const domain of [
      "javascript:alert(1)",
      "Click here to verify your account at attacker.example",
      "example.com/../../etc/passwd",
      "-example.com",
      "localhost",
      `${"a".repeat(300)}.com`,
    ]) {
      const { unmount } = render(<AddDomainBanner added="created" domain={domain} />);
      expect(screen.getByText("Now tracking that domain."), `${domain} was echoed`).toBeTruthy();
      unmount();
    }
  });
});
