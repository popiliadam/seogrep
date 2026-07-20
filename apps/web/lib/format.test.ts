import { describe, expect, it } from "vitest";
import { formatDate, formatNumber } from "./format";

/**
 * Pins the consolidated formatters byte-for-byte to the behaviour their former inline copies
 * had (dashboard formatNumber/formatDate, connection formatDate, pricing formatCredits).
 */

describe("formatNumber", () => {
  it("inserts thousands separators for large integers", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("leaves sub-thousand values untouched and keeps zero as '0'", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(999)).toBe("999");
  });

  it("keeps the sign on negative values (grouping the magnitude)", () => {
    expect(formatNumber(-2500)).toBe("-2,500");
    expect(formatNumber(-7)).toBe("-7");
  });
});

describe("formatDate", () => {
  it("renders an ISO timestamp as YYYY-MM-DD", () => {
    expect(formatDate("2026-07-20T13:45:06.000Z")).toBe("2026-07-20");
    expect(formatDate("2026-01-02")).toBe("2026-01-02");
  });

  it("falls back to the raw value when it cannot be parsed", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDate("")).toBe("");
  });
});
