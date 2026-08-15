import { describe, expect, it } from "vitest";
import { lastVerifiedLabel } from "./token-health";

const NOW = new Date("2026-08-15T12:00:00.000Z");

/** `NOW` minus whole days, as the column stores it. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("lastVerifiedLabel", () => {
  it("says nothing at all when the account has never been checked", () => {
    // Every row migration 0021 created starts here. "Last verified —" is not a fact.
    expect(lastVerifiedLabel(null, NOW)).toBeNull();
    expect(lastVerifiedLabel(undefined, NOW)).toBeNull();
  });

  it("says nothing rather than inventing an age from an unparseable value", () => {
    expect(lastVerifiedLabel("not-a-timestamp", NOW)).toBeNull();
  });

  it("names today, one day, and many days in the shape the MCP provenance line uses", () => {
    expect(lastVerifiedLabel(daysAgo(0), NOW)).toBe("today");
    expect(lastVerifiedLabel(daysAgo(1), NOW)).toBe("1 day ago");
    expect(lastVerifiedLabel(daysAgo(12), NOW)).toBe("12 days ago");
  });

  it("floors, so a partial day is still today", () => {
    expect(lastVerifiedLabel(new Date(NOW.getTime() - 23 * 3_600_000).toISOString(), NOW)).toBe(
      "today",
    );
  });

  it("reads a FUTURE stamp as today rather than as a negative age", () => {
    // Clock skew between the web process and Postgres is real; "-1 days ago" is not a thing to
    // print at a user.
    expect(lastVerifiedLabel(daysAgo(-3), NOW)).toBe("today");
  });
});
