import { describe, expect, it, vi } from "vitest";
import {
  createAuthenticator,
  createRateLimiter,
  hasValidKeyFormat,
  safeKeyPrefix,
  type AuthDecision,
  type KeyRecord,
  type RateLimiter,
} from "./auth.ts";

const RECORD: KeyRecord = { keyId: "key-1", userId: "user-A" };
const OK: AuthDecision = { status: "ok", context: { userId: "user-A", keyId: "key-1" } };
const ALLOW: RateLimiter = { tryConsume: () => true };

describe("hasValidKeyFormat", () => {
  it("accepts an sg_-prefixed key with a body", () => {
    expect(hasValidKeyFormat("sg_testkey1234")).toBe(true);
  });

  it.each(["", "sg_", "nope", "SG_upper", " sg_x"])("rejects malformed key %j", (key) => {
    expect(hasValidKeyFormat(key)).toBe(false);
  });
});

describe("safeKeyPrefix", () => {
  it("returns sg_ + 8 chars and never the secret body", () => {
    const prefix = safeKeyPrefix("sg_1234567890ABCDEF_SECRET_TAIL");
    expect(prefix).toBe("sg_12345678");
    expect(prefix).toHaveLength(11);
    expect(prefix.includes("SECRET")).toBe(false);
  });
});

describe("createAuthenticator", () => {
  it("resolves a known active key to its tenant context", async () => {
    const lookup = vi.fn(async () => RECORD);
    const authenticate = createAuthenticator({ lookup, rateLimiter: ALLOW });
    expect(await authenticate("sg_validbody")).toEqual(OK);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("hashes the key with sha256 before lookup (plaintext never passed to storage)", async () => {
    const lookup = vi.fn(async () => RECORD);
    await createAuthenticator({ lookup, rateLimiter: ALLOW })("sg_validbody");
    const passed = lookup.mock.calls[0]?.[0];
    expect(passed).toMatch(/^[0-9a-f]{64}$/);
    expect(passed).not.toContain("sg_validbody");
  });

  it("rejects a malformed key WITHOUT touching storage or the limiter (fast reject before I/O)", async () => {
    const lookup = vi.fn(async () => RECORD);
    const tryConsume = vi.fn(() => true);
    const authenticate = createAuthenticator({ lookup, rateLimiter: { tryConsume } });
    expect(await authenticate("nope")).toEqual({ status: "unauthorized" });
    expect(lookup).not.toHaveBeenCalled();
    expect(tryConsume).not.toHaveBeenCalled();
  });

  it("unknown/revoked key (lookup miss): unauthorized, no stamp, no token consumed", async () => {
    const lookup = vi.fn(async () => null);
    const stamp = vi.fn(async () => undefined);
    const tryConsume = vi.fn(() => true);
    const authenticate = createAuthenticator({ lookup, stamp, rateLimiter: { tryConsume } });
    expect(await authenticate("sg_validbody")).toEqual({ status: "unauthorized" });
    expect(stamp).not.toHaveBeenCalled();
    expect(tryConsume).not.toHaveBeenCalled();
  });

  it("consults the per-key limiter with the key id, AFTER the lookup", async () => {
    const lookup = vi.fn(async () => RECORD);
    const tryConsume = vi.fn(() => true);
    await createAuthenticator({ lookup, rateLimiter: { tryConsume } })("sg_validbody");
    expect(tryConsume).toHaveBeenCalledExactlyOnceWith("key-1");
    expect(lookup.mock.invocationCallOrder[0]).toBeLessThan(
      tryConsume.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("over-limit key: rate_limited decision, at most one read and ZERO writes", async () => {
    const lookup = vi.fn(async () => RECORD);
    const stamp = vi.fn(async () => undefined);
    const onStamp = vi.fn();
    const authenticate = createAuthenticator({
      lookup,
      stamp,
      onStamp,
      rateLimiter: { tryConsume: () => false },
    });
    expect(await authenticate("sg_validbody")).toEqual({ status: "rate_limited" });
    expect(lookup).toHaveBeenCalledOnce(); // at most 1 read
    expect(stamp).not.toHaveBeenCalled(); // ZERO writes on the 429 path
    expect(onStamp).not.toHaveBeenCalled(); // the stamp was never even fired
  });

  it("stamps last_used_at with the injected clock on success", async () => {
    const lookup = vi.fn(async () => RECORD);
    const stamp = vi.fn(async () => undefined);
    const when = new Date("2026-07-19T00:00:00.000Z");
    let settled: Promise<void> | undefined;
    const authenticate = createAuthenticator({
      lookup,
      stamp,
      rateLimiter: ALLOW,
      now: () => when,
      onStamp: (p) => {
        settled = p;
      },
    });
    expect(await authenticate("sg_validbody")).toEqual(OK);
    await settled;
    expect(stamp).toHaveBeenCalledWith("key-1", when);
  });

  it("still authenticates when the stamp rejects, and logs only the safe prefix", async () => {
    const lookup = vi.fn(async () => RECORD);
    const stamp = vi.fn(async () => {
      throw new Error("db down");
    });
    const onError = vi.fn();
    let settled: Promise<void> | undefined;
    const authenticate = createAuthenticator({
      lookup,
      stamp,
      rateLimiter: ALLOW,
      onError,
      onStamp: (p) => {
        settled = p;
      },
    });
    expect(await authenticate("sg_1234567890ABCDEF_SECRET")).toEqual(OK);
    await settled;
    expect(onError).toHaveBeenCalledOnce();
    const logged = String(onError.mock.calls[0]?.[0]);
    expect(logged).toContain("sg_12345678");
    expect(logged).not.toContain("SECRET");
  });
});

describe("createRateLimiter (token bucket)", () => {
  it("allows up to capacity, then rejects until a token refills", () => {
    let ms = 0;
    const rl = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => ms });
    expect(rl.tryConsume("k")).toBe(true);
    expect(rl.tryConsume("k")).toBe(true);
    expect(rl.tryConsume("k")).toBe(false);
    ms = 1000;
    expect(rl.tryConsume("k")).toBe(true);
    expect(rl.tryConsume("k")).toBe(false);
  });

  it("caps refill at capacity (idle time never accrues unbounded burst)", () => {
    let ms = 0;
    const rl = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => ms });
    expect(rl.tryConsume("k")).toBe(true);
    ms = 100_000;
    expect(rl.tryConsume("k")).toBe(true);
    expect(rl.tryConsume("k")).toBe(true);
    expect(rl.tryConsume("k")).toBe(false);
  });

  it("keeps an independent bucket per id", () => {
    const ms = 0;
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => ms });
    expect(rl.tryConsume("a")).toBe(true);
    expect(rl.tryConsume("a")).toBe(false);
    expect(rl.tryConsume("b")).toBe(true);
  });

  it("defaults to a 60-request allowance (60/min)", () => {
    const ms = 0;
    const rl = createRateLimiter({ now: () => ms });
    for (let i = 0; i < 60; i += 1) {
      expect(rl.tryConsume("k")).toBe(true);
    }
    expect(rl.tryConsume("k")).toBe(false);
  });
});
