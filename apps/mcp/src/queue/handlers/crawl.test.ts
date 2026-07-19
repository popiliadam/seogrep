import { describe, expect, it } from "vitest";
import { clampMaxUrls } from "./crawl.ts";

/**
 * Fast unit tests for clampMaxUrls — the guard that keeps a malformed/tampered queue
 * payload from reaching the crawler as an unbounded or NaN page cap. No DB/network:
 * the end-to-end crawl handler is covered in crawl.db.test.ts.
 */
describe("clampMaxUrls", () => {
  it("passes a valid in-range integer through unchanged", () => {
    expect(clampMaxUrls(25)).toBe(25);
    expect(clampMaxUrls(1)).toBe(1);
    expect(clampMaxUrls(100)).toBe(100);
  });

  it("clamps below 1 up to 1 and above 100 down to 100", () => {
    expect(clampMaxUrls(0)).toBe(1);
    expect(clampMaxUrls(-5)).toBe(1);
    expect(clampMaxUrls(1000)).toBe(100);
  });

  it("floors a fractional value", () => {
    expect(clampMaxUrls(3.9)).toBe(3);
  });

  it("rejects non-finite / non-number values -> undefined (crawler default applies)", () => {
    expect(clampMaxUrls(Infinity)).toBeUndefined();
    expect(clampMaxUrls(-Infinity)).toBeUndefined();
    expect(clampMaxUrls(Number.NaN)).toBeUndefined();
    expect(clampMaxUrls(undefined)).toBeUndefined();
    expect(clampMaxUrls("50")).toBeUndefined();
    expect(clampMaxUrls(null)).toBeUndefined();
  });
});
