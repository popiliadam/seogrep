import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePaddleEnvironment } from "./paddle-env";

/**
 * Pins the ONE Paddle environment resolver shared by the browser checkout overlay and the
 * server-side Node SDK. Only the two exact literals resolve; anything else is undefined, which
 * keeps the checkout button fail-closed and leaves the server SDK on its own default rather
 * than guessing an API base from a typo.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePaddleEnvironment", () => {
  it("resolves the two exact valid environments", () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "sandbox");
    expect(resolvePaddleEnvironment()).toBe("sandbox");
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "production");
    expect(resolvePaddleEnvironment()).toBe("production");
  });

  it("is case-sensitive — a differently-cased value does not resolve", () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "PRODUCTION");
    expect(resolvePaddleEnvironment()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "Sandbox");
    expect(resolvePaddleEnvironment()).toBeUndefined();
  });

  it("does not trim — a padded value does not resolve", () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", " sandbox ");
    expect(resolvePaddleEnvironment()).toBeUndefined();
  });

  it("returns undefined for an empty, unknown or unset value", () => {
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "");
    expect(resolvePaddleEnvironment()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", "staging");
    expect(resolvePaddleEnvironment()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_PADDLE_ENV", undefined);
    expect(resolvePaddleEnvironment()).toBeUndefined();
  });
});
