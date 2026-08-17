import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@pseo/db/ledger-read";
import { cumulativeSpend, spendByDay, spendEvents, trailingUtcDays, utcDayStart } from "./spend";

/**
 * Fixtures deliberately use the shapes the DB actually permits (migrations 0002/0005/0011):
 * `spend_commit` ALWAYS carries delta 0 (`credit_ledger_spend_commit_zero_delta`), `spend_reserve`
 * is always negative, `spend_release` always positive. Writing a `spend_commit` with delta -70
 * to "make the chart work" would be inventing a row the database has never stored — exactly the
 * tolerant-double failure that let the dead filter survive.
 */
let nextId = 0;
function row(partial: Partial<LedgerEntry> & Pick<LedgerEntry, "kind" | "delta">): LedgerEntry {
  nextId += 1;
  return {
    id: nextId,
    createdAt: "2026-08-10T12:00:00.000Z",
    reason: null,
    tool: "audit_content",
    ...partial,
  };
}

/** A settled spend of `amount` credits: the reserve that moved the balance + its zero marker. */
function committedSpend(amount: number, createdAt: string): LedgerEntry[] {
  return [
    row({ kind: "spend_reserve", delta: -amount, createdAt }),
    row({ kind: "spend_commit", delta: 0, createdAt }),
  ];
}

/** A refunded spend: reserve, then a full-amount release. Nets to zero. */
function releasedSpend(amount: number, createdAt: string, releasedAt = createdAt): LedgerEntry[] {
  return [
    row({ kind: "spend_reserve", delta: -amount, createdAt }),
    row({ kind: "spend_release", delta: amount, createdAt: releasedAt }),
  ];
}

describe("spendEvents", () => {
  it("counts the reserve (not the zero-delta commit) as the spend", () => {
    const events = spendEvents(committedSpend(70, "2026-08-10T12:00:00.000Z"));
    expect(events).toEqual([{ at: Date.parse("2026-08-10T12:00:00.000Z"), amount: 70 }]);
  });

  it("a spend_commit row on its own contributes NOTHING (its delta is always 0)", () => {
    expect(spendEvents([row({ kind: "spend_commit", delta: 0 })])).toEqual([]);
  });

  it("nets a released reserve back out to zero", () => {
    const events = spendEvents(releasedSpend(40, "2026-08-10T12:00:00.000Z"));
    expect(events.map((event) => event.amount)).toEqual([40, -40]);
    expect(events.reduce((sum, event) => sum + event.amount, 0)).toBe(0);
  });

  it("ignores grants, purchases and adjusts — only spend_* moves the chart", () => {
    const entries = [
      row({ kind: "grant", delta: 200 }),
      row({ kind: "purchase", delta: 400 }),
      row({ kind: "adjust", delta: -25 }),
    ];
    expect(spendEvents(entries)).toEqual([]);
  });

  it("drops unparseable timestamps and applies the `since` cutoff", () => {
    const entries = [
      row({ kind: "spend_reserve", delta: -10, createdAt: "not-a-date" }),
      row({ kind: "spend_reserve", delta: -20, createdAt: "2026-08-01T00:00:00.000Z" }),
      row({ kind: "spend_reserve", delta: -30, createdAt: "2026-08-10T00:00:00.000Z" }),
    ];
    const since = Date.parse("2026-08-05T00:00:00.000Z");
    expect(spendEvents(entries, { since }).map((event) => event.amount)).toEqual([30]);
  });

  it("sorts oldest first and never mutates the input array", () => {
    const entries = [
      row({ kind: "spend_reserve", delta: -5, createdAt: "2026-08-12T00:00:00.000Z" }),
      row({ kind: "spend_reserve", delta: -6, createdAt: "2026-08-11T00:00:00.000Z" }),
    ];
    const snapshot = [...entries];
    expect(spendEvents(entries).map((event) => event.amount)).toEqual([6, 5]);
    expect(entries).toEqual(snapshot);
  });
});

describe("trailingUtcDays / utcDayStart", () => {
  it("ends on the UTC day `now` falls in and runs oldest first", () => {
    const now = Date.parse("2026-08-17T23:30:00.000Z");
    const days = trailingUtcDays(14, now);
    expect(days).toHaveLength(14);
    expect(days[13]).toBe(Date.parse("2026-08-17T00:00:00.000Z"));
    expect(days[0]).toBe(Date.parse("2026-08-04T00:00:00.000Z"));
  });

  it("buckets a late-evening timestamp into its own UTC day", () => {
    expect(utcDayStart(Date.parse("2026-08-17T23:59:59.000Z"))).toBe(
      Date.parse("2026-08-17T00:00:00.000Z"),
    );
  });
});

describe("spendByDay", () => {
  const days = trailingUtcDays(14, Date.parse("2026-08-17T10:00:00.000Z"));

  it("sums a day's reserves into that day's bucket", () => {
    const entries = [
      ...committedSpend(70, "2026-08-16T09:00:00.000Z"),
      ...committedSpend(12, "2026-08-16T18:00:00.000Z"),
      ...committedSpend(25, "2026-08-17T01:00:00.000Z"),
    ];
    const values = spendByDay(spendEvents(entries), days);
    expect(values[12]).toBe(82);
    expect(values[13]).toBe(25);
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(107);
  });

  it("a same-day refund cancels its reserve out of that day", () => {
    const values = spendByDay(spendEvents(releasedSpend(40, "2026-08-16T09:00:00.000Z")), days);
    expect(values[12]).toBe(0);
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it("a next-day refund lands on the refund's OWN day, which may go negative", () => {
    const entries = releasedSpend(40, "2026-08-16T09:00:00.000Z", "2026-08-17T09:00:00.000Z");
    const values = spendByDay(spendEvents(entries), days);
    expect(values[12]).toBe(40);
    expect(values[13]).toBe(-40);
  });

  it("ignores events outside the day window", () => {
    const values = spendByDay(spendEvents(committedSpend(99, "2026-07-01T00:00:00.000Z")), days);
    expect(values.every((value) => value === 0)).toBe(true);
  });
});

describe("cumulativeSpend", () => {
  it("accumulates and steps back down on a refund", () => {
    const entries = [
      ...committedSpend(30, "2026-08-10T00:00:00.000Z"),
      ...releasedSpend(20, "2026-08-11T00:00:00.000Z", "2026-08-12T00:00:00.000Z"),
    ];
    expect(cumulativeSpend(spendEvents(entries)).map((point) => point.running)).toEqual([
      30, 50, 30,
    ]);
  });

  it("is empty for an empty event list", () => {
    expect(cumulativeSpend([])).toEqual([]);
  });
});
