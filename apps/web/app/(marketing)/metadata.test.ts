import { describe, expect, it } from "vitest";
import { metadata as howItWorks } from "./how-it-works/page";
import { metadata as landing } from "./page";
import { metadata as pricing } from "./pricing/page";
import { metadata as privacy } from "./privacy/page";
import { metadata as terms } from "./terms/page";

// Audit G2: the 5 marketing pages set only `title` and inherited the root 178-char description, so
// every one shipped the same over-long <meta name="description">. Each now sets its own.
const PAGES = [
  ["/", landing],
  ["/pricing", pricing],
  ["/how-it-works", howItWorks],
  ["/terms", terms],
  ["/privacy", privacy],
] as const;

describe("marketing page metadata", () => {
  it("gives every page its own non-empty description", () => {
    for (const [route, meta] of PAGES) {
      expect(typeof meta.description, `${route} description type`).toBe("string");
      expect((meta.description as string).trim().length, `${route} description empty`).toBeGreaterThan(0);
    }
  });

  it("keeps every description distinct (no duplicate meta across pages)", () => {
    const descriptions = PAGES.map(([, meta]) => meta.description);
    expect(new Set(descriptions).size).toBe(PAGES.length);
  });

  it("keeps every description within the meta-length budget (<=160 chars)", () => {
    for (const [route, meta] of PAGES) {
      expect((meta.description as string).length, `${route} description too long`).toBeLessThanOrEqual(160);
    }
  });

  it("keeps each page's own title", () => {
    for (const [route, meta] of PAGES) {
      expect(typeof meta.title, `${route} title`).toBe("string");
      expect((meta.title as string).length, `${route} title empty`).toBeGreaterThan(0);
    }
  });

  it("carries no price numbers in the copy (NEVER #6 — pricing lives in pricing-plans.ts)", () => {
    for (const [route, meta] of PAGES) {
      expect(meta.description as string, `${route} has a currency amount`).not.toMatch(/\$\d/);
    }
  });
});
