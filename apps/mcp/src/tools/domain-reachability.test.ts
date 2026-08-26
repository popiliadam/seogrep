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
