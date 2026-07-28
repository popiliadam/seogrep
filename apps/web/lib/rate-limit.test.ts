import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, createRateLimiter, UNKNOWN_CLIENT } from "./rate-limit";

/** A pinned clock so refill behaviour is asserted, not slept for. */
function clock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let nowMs = startMs;
  return { now: () => nowMs, advance: (ms: number) => void (nowMs += ms) };
}

describe("createRateLimiter", () => {
  it("hands a first-time id its whole burst, then refuses", () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: clock().now });
    expect([limiter.tryConsume("a"), limiter.tryConsume("a"), limiter.tryConsume("a")]).toEqual([
      true,
      true,
      true,
    ]);
    expect(limiter.tryConsume("a")).toBe(false);
  });

  it("keeps a separate budget per id", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: clock().now });
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
    expect(limiter.tryConsume("b")).toBe(true);
  });

  it("refills at the configured rate and never past capacity", () => {
    const time = clock();
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 0.5, now: time.now });
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);

    time.advance(2_000); // one token back at 0.5/s
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);

    time.advance(60_000); // long idle must not bank more than `capacity`
    expect([limiter.tryConsume("a"), limiter.tryConsume("a")]).toEqual([true, true]);
    expect(limiter.tryConsume("a")).toBe(false);
  });

  it("bounds memory by clearing every bucket once maxEntries is reached", () => {
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSecond: 0,
      maxEntries: 2,
      now: clock().now,
    });
    expect(limiter.tryConsume("a")).toBe(true);
    expect(limiter.tryConsume("b")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(false);
    // Admitting a third id clears the map — the documented, deliberate tradeoff.
    expect(limiter.tryConsume("c")).toBe(true);
    expect(limiter.tryConsume("a")).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers the Netlify edge header over a client-supplied x-forwarded-for", () => {
    const headers = new Headers({
      "x-nf-client-connection-ip": "198.51.100.7",
      "x-forwarded-for": "10.0.0.1, 172.16.0.1",
    });
    expect(clientIpFromHeaders(headers)).toBe("198.51.100.7");
  });

  it("falls back to the leftmost x-forwarded-for entry", () => {
    const headers = new Headers({ "x-forwarded-for": " 203.0.113.9 , 172.16.0.1" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("uses one shared bucket key when no address is present", () => {
    expect(clientIpFromHeaders(new Headers())).toBe(UNKNOWN_CLIENT);
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "  " }))).toBe(UNKNOWN_CLIENT);
  });
});
