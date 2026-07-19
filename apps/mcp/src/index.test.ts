import { describe, expect, it } from "vitest";
import { resolveMode } from "./index.js";

describe("resolveMode", () => {
  it("defaults to web when MODE is unset", () => {
    expect(resolveMode(undefined)).toBe("web");
  });

  it.each(["web", "worker"] as const)("accepts MODE=%s", (mode) => {
    expect(resolveMode(mode)).toBe(mode);
  });

  it("throws on an unknown MODE", () => {
    expect(() => resolveMode("api")).toThrowError(/Unknown MODE "api"/);
  });
});
