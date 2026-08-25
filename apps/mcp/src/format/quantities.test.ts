import { describe, expect, it } from "vitest";
import {
  bucketDateLabel,
  estimatedMonthlyCostUsd,
  estimatedVisitsPerMonth,
  exactCount,
} from "./quantities.ts";

/**
 * The precision CLAIM of each quantity class, pinned as behaviour.
 *
 * These specs are about meaning, not spelling: what they assert is that a modelled float stops
 * claiming fifteen significant figures, that a counted integer loses nothing, and that a label
 * component is dropped only when it provably carries no information. The rendered wording each
 * tool wraps around these values is pinned in that tool's own spec, driving that tool's real
 * renderer.
 */

describe("exactCount — class 1, nothing is dropped", () => {
  it("keeps every digit of a counted quantity and only groups them", () => {
    expect(exactCount(0)).toBe("0");
    expect(exactCount(6)).toBe("6");
    expect(exactCount(1248)).toBe("1,248");
    expect(exactCount(5312709)).toBe("5,312,709");
  });

  it("never prints a fraction of a countable thing", () => {
    expect(exactCount(6.4)).not.toMatch(/\./);
    expect(exactCount(6.4)).toBe("6");
  });
});

describe("estimatedVisitsPerMonth — class 2, whole visits", () => {
  /**
   * THE MEASURED DEFECT. `my_pages` printed this exact float verbatim; a model that resolved a
   * page's monthly traffic to 1e-14 of a visit would be a different product.
   */
  it("stops a raw model float claiming fifteen significant figures", () => {
    expect(estimatedVisitsPerMonth(86.03599891066551)).toBe("86/mo");
    expect(estimatedVisitsPerMonth(86.03599891066551)).not.toMatch(/\d\.\d/);
  });

  /**
   * THE REFERENCE. `ranked_keywords` renders the vendor's `etv` of 116.64 as "117" and is out of
   * scope and correct; this module was written to match it, not to replace it.
   */
  it("rounds the way ranked_keywords already rounds: 116.64 becomes 117", () => {
    expect(estimatedVisitsPerMonth(116.64)).toBe("117/mo");
  });

  it("carries the period so the number cannot be read as per-day or lifetime", () => {
    expect(estimatedVisitsPerMonth(1842.5)).toBe("1,843/mo");
  });

  it("prints a vendor zero as zero — it is an answer, not a silence", () => {
    expect(estimatedVisitsPerMonth(0)).toBe("0/mo");
  });
});

describe("estimatedMonthlyCostUsd — class 3, whole dollars", () => {
  it("drops cents from a modelled monthly total and names the currency and period", () => {
    expect(estimatedMonthlyCostUsd(5120.75)).toBe("$5,121/mo");
    expect(estimatedMonthlyCostUsd(188.2)).toBe("$188/mo");
  });

  it("never renders a modelled monthly total as an invoice with cents", () => {
    expect(estimatedMonthlyCostUsd(5120.75)).not.toMatch(/\.\d/);
  });
});

describe("bucketDateLabel — class 4, drop only what carries nothing", () => {
  it("reduces a midnight-UTC vendor timestamp to its calendar date", () => {
    expect(bucketDateLabel("2021-12-31 00:00:00 +00:00")).toBe("2021-12-31");
    expect(bucketDateLabel("2025-08-31 00:00:00 +00:00")).toBe("2025-08-31");
  });

  it("accepts the offset spellings that still mean midnight UTC", () => {
    expect(bucketDateLabel("2021-12-31 00:00:00")).toBe("2021-12-31");
    expect(bucketDateLabel("2021-12-31T00:00:00Z")).toBe("2021-12-31");
    expect(bucketDateLabel("2021-12-31 00:00:00 +0000")).toBe("2021-12-31");
  });

  /**
   * THE NARROWNESS IS THE SAFETY. A time of day, and a zero clock under a NON-zero offset (which
   * is not midnight UTC at all), are information; both survive untouched. So does anything that
   * is not a timestamp — the vendor's own label always beats a label we invented.
   */
  it("keeps a timestamp that carries a real time of day", () => {
    expect(bucketDateLabel("2021-12-31 13:05:00 +00:00")).toBe("2021-12-31 13:05:00 +00:00");
  });

  it("keeps a zero clock under a non-zero offset, which is not midnight UTC", () => {
    expect(bucketDateLabel("2021-12-31 00:00:00 +03:00")).toBe("2021-12-31 00:00:00 +03:00");
  });

  it("returns anything it does not recognise verbatim", () => {
    expect(bucketDateLabel("2021-12")).toBe("2021-12");
    expect(bucketDateLabel("not a date")).toBe("not a date");
  });
});
