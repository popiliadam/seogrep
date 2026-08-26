import { describe, expect, it } from "vitest";
import {
  DOMAIN_LOOKUP_TIMEOUT_MS,
  classifyLookupFailure,
  reachabilityWarning,
  type DomainReachability,
} from "./domain-reachability.ts";

/**
 * The DNS port's own lane. No lookup is performed here — the classifier is fed the ERROR SHAPES
 * Node's resolver actually produces, which is the half that decides whether a customer is told
 * their domain does not exist.
 */

/** A rejection shaped like Node's, i.e. an Error carrying a `code`. */
function dnsError(code: string): Error {
  return Object.assign(new Error(`getaddrinfo ${code} example.test`), { code });
}

describe("classifyLookupFailure", () => {
  it("calls it 'no such domain' only for the two codes that mean exactly that", () => {
    expect(classifyLookupFailure(dnsError("ENOTFOUND"))).toBe("no_such_domain");
    expect(classifyLookupFailure(dnsError("EAI_NODATA"))).toBe("no_such_domain");
  });

  /**
   * THE FAIL-OPEN HALF, and the one the design constraint names: a check that could not RUN must
   * never be reported as a domain that does not exist. Get this backwards and every registration
   * during a DNS blip warns the customer that their live site is gone.
   *
   * `EAI_AGAIN` is the classic temporary DNS failure and is the case that would actually happen;
   * the rest are asserted because "default to unknown" has to hold for shapes nobody anticipated,
   * which is precisely what a whitelist of known-bad codes cannot promise.
   */
  it("is 'unknown' for every failure that is the RESOLVER failing, not the domain missing", () => {
    for (const code of ["EAI_AGAIN", "ETIMEOUT", "ECONNREFUSED", "ESERVFAIL", "EIO"]) {
      expect(classifyLookupFailure(dnsError(code)), code).toBe("unknown");
    }
  });

  it("is 'unknown' for an error carrying no code at all, and for a non-error rejection", () => {
    expect(classifyLookupFailure(new Error("boom"))).toBe("unknown");
    expect(classifyLookupFailure(null)).toBe("unknown");
    expect(classifyLookupFailure(undefined)).toBe("unknown");
    expect(classifyLookupFailure("ENOTFOUND")).toBe("unknown");
  });

  /** A ceiling on latency, pinned so it cannot creep into a number a 0-credit tool cannot afford. */
  it("caps the lookup at two seconds", () => {
    expect(DOMAIN_LOOKUP_TIMEOUT_MS).toBe(2_000);
  });
});

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
