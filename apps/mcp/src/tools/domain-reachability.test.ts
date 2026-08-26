import { describe, expect, it } from "vitest";
import { reachabilityWarning, type DomainReachability } from "./domain-reachability.ts";

/**
 * THIS SURFACE'S SENTENCE, and only that. The port itself (the lookup, its two-second ceiling
 * and the classifier that decides "no such name" versus "we did not find out") moved to
 * @pseo/core on 2026-08-26 and is measured in `packages/core/src/net/reachability.test.ts` —
 * the package that exports a judgement tests it, or the day this suite is rewritten core's own
 * lane says nothing about it (imzalı ders 15).
 */
describe("reachabilityWarning", () => {
  it("warns only on a positive 'no such name'", () => {
    expect(reachabilityWarning("x.com", "no_such_domain")).not.toBe("");
    for (const quiet of ["resolves", "unknown"] as DomainReachability[]) {
      expect(reachabilityWarning("x.com", quiet), quiet).toBe("");
    }
  });

  /**
   * The operator signed WARN, not block. The sentence has to carry three things: the finding, the
   * fact that the project EXISTS anyway, and the innocent explanation — a customer told "this
   * looks wrong" about a correct decision stops reading the warnings that matter.
   */
  it("names the domain, says the project is registered, and allows for a pre-launch site", () => {
    const text = reachabilityWarning("not-launched-yet.com", "no_such_domain");
    expect(text).toContain("not-launched-yet.com");
    expect(text).toMatch(/does not resolve/i);
    expect(text).toMatch(/registered/i);
    expect(text).toMatch(/not launched yet|not live/i);
  });
});

/**
 * ONE ANSWER, ONE NAME — measured on the live tool 2026-08-26, minutes after the IDN display fix
 * shipped. `setup_project("smoke-dalga2-örnek.com")` replied:
 *
 *   Created project for "smoke-dalga2-örnek.com (xn--smoke-dalga2-rnek-c0b.com)" …
 *   Heads up: xn--smoke-dalga2-rnek-c0b.com does not resolve …
 *
 * The receipt had learned the customer's spelling and this paragraph had not, so a single reply
 * named one site two ways. The axis that went unvaried when D-4 was fixed was not "which tool"
 * but "which SENTENCE inside one reply".
 */
describe("reachabilityWarning — the IDN name", () => {
  it("opens with the name the customer typed, not the A-label", () => {
    const text = reachabilityWarning("xn--rnek-4qa.com", "no_such_domain");
    expect(text).toContain("örnek.com does not resolve");
    expect(text).not.toContain("xn--rnek-4qa.com");
  });

  it("leaves an ASCII domain exactly as it is", () => {
    expect(reachabilityWarning("not-launched-yet.com", "no_such_domain")).toContain(
      "not-launched-yet.com does not resolve",
    );
  });
});
