import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "./index.js";

describe("@pseo/db", () => {
  it("şema sürümü Faz 2 öncesi 0", () => {
    expect(SCHEMA_VERSION).toBe(0);
  });
});
