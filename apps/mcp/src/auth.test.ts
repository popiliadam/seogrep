import { describe, expect, it, vi } from "vitest";
import {
  createAuthenticator,
  createRateLimiter,
  hasValidKeyFormat,
  safeKeyPrefix,
  type KeyRecord,
} from "./auth.ts";

const RECORD: KeyRecord = { keyId: "key-1", userId: "user-A" };

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
    const authenticate = createAuthenticator({ lookup });
    expect(await authenticate("sg_validbody")).toEqual({ userId: "user-A", keyId: "key-1" });
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("hashes the key with sha256 before lookup (plaintext never passed to storage)", async () => {
    const lookup = vi.fn(async () => RECORD);
    await createAuthenticator({ lookup })("sg_validbody");
    const passed = lookup.mock.calls[0]?.[0];
    expect(passed).toMatch(/^[0-9a-f]{64}$/);
    expect(passed).not.toContain("sg_validbody");
  });

  it("rejects a malformed key WITHOUT touching storage (fast reject before I/O)", async () => {
    const lookup = vi.fn(async () => RECORD);
    expect(await createAuthenticator({ lookup })("nope")).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns null for an unknown/revoked key (lookup miss) and does not stamp", async () => {
    const lookup = vi.fn(async () => null);
    const stamp = vi.fn(async () => undefined);
    expect(await createAuthenticator({ lookup, stamp })("sg_validbody")).toBeNull();
    expect(stamp).not.toHaveBeenCalled();
  });

  it("stamps last_used_at with the injected clock on success", async () => {
    const lookup = vi.fn(async () => RECORD);
    const stamp = vi.fn(async () => undefined);
    const when = new Date("2026-07-19T00:00:00.000Z");
    let settled: Promise<void> | undefined;
    const authenticate = createAuthenticator({
      lookup,
      stamp,
      now: () => when,
      onStamp: (p) => {
        settled = p;
      },
    });
    await authenticate("sg_validbody");
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
      onError,
      onStamp: (p) => {
        settled = p;
      },
    });
    expect(await authenticate("sg_1234567890ABCDEF_SECRET")).toEqual({
      userId: "user-A",
      keyId: "key-1",
    });
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
