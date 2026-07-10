import { describe, expect, it } from "vitest";
import { CREDIT_BASE_USD } from "./index.js";

describe("@pseo/core", () => {
  it("kredi taban değeri spec §3 ile aynı", () => {
    expect(CREDIT_BASE_USD).toBe(0.01);
  });
});
