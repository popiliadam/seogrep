import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEntry } from "@pseo/db/ledger-read";
import { DeltaAmount, KindBadge, LedgerTable, SpendChart, SpendSparkline, StatCard } from "./ui";

describe("app dashboard ui", () => {
  it("KindBadge maps kinds to human labels (spend_commit -> neutral 'commit')", () => {
    render(
      <>
        <KindBadge kind="grant" />
        <KindBadge kind="spend_reserve" />
        <KindBadge kind="spend_commit" />
      </>,
    );
    expect(screen.getByText("grant")).toBeTruthy();
    expect(screen.getByText("reserve")).toBeTruthy();
    expect(screen.getByText("commit")).toBeTruthy();
  });

  it("DeltaAmount prefixes positives with + and leaves zero unsigned", () => {
    render(
      <>
        <DeltaAmount delta={200} />
        <DeltaAmount delta={-50} />
        <DeltaAmount delta={0} />
      </>,
    );
    expect(screen.getByText("+200")).toBeTruthy();
    expect(screen.getByText("-50")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("StatCard shows its label and value", () => {
    render(<StatCard label="Available credits" value="1,234" />);
    expect(screen.getByText("Available credits")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
  });

  it("LedgerTable shows the empty state, then renders a row (date + kind + signed delta)", () => {
    const { rerender } = render(<LedgerTable entries={[]} />);
    expect(screen.getByText("No activity yet.")).toBeTruthy();

    rerender(
      <LedgerTable
        entries={[
          {
            id: 1,
            createdAt: "2026-07-01T12:00:00.000Z",
            delta: 200,
            kind: "grant",
            reason: "trial",
            tool: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("2026-07-01")).toBeTruthy();
    expect(screen.getByText("grant")).toBeTruthy();
    expect(screen.getByText("+200")).toBeTruthy();
  });
});

/**
 * The spend surfaces. These exist because the previous suite asserted nothing about them:
 * both components filtered on `spend_commit && delta < 0`, a shape migration 0011's
 * `credit_ledger_spend_commit_zero_delta` CHECK makes IMPOSSIBLE, so the sparkline returned
 * null and the chart drew "0 total" on every account in production — and every test still
 * passed. So the assertions below are about drawn OUTPUT: a polyline that exists, a bar with a
 * real height, a total that is not zero.
 *
 * Fixtures keep the DB's true shapes (commit rows carry delta 0). The clock is frozen, so a run
 * at 00:00 UTC buckets the same way as a run at noon.
 */
const NOW = "2026-08-17T12:00:00.000Z";

let fixtureId = 0;
function ledgerRow(
  partial: Partial<LedgerEntry> & Pick<LedgerEntry, "kind" | "delta" | "createdAt">,
): LedgerEntry {
  fixtureId += 1;
  return { id: fixtureId, reason: null, tool: "crawl_site", ...partial };
}

/** reserve (moves the balance) + zero-delta commit marker — one settled spend of `amount`. */
function settled(amount: number, createdAt: string): LedgerEntry[] {
  return [
    ledgerRow({ kind: "spend_reserve", delta: -amount, createdAt }),
    ledgerRow({ kind: "spend_commit", delta: 0, createdAt }),
  ];
}

/** reserve + full release — a refunded spend, which must NOT count. */
function refunded(amount: number, createdAt: string): LedgerEntry[] {
  return [
    ledgerRow({ kind: "spend_reserve", delta: -amount, createdAt }),
    ledgerRow({ kind: "spend_release", delta: amount, createdAt }),
  ];
}

describe("SpendChart", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws a real bar and a non-zero total for settled spend", () => {
    const { container } = render(
      <SpendChart
        entries={[
          ...settled(70, "2026-08-16T09:00:00.000Z"),
          ...settled(12, "2026-08-16T18:00:00.000Z"),
          ...settled(25, "2026-08-17T01:00:00.000Z"),
        ]}
      />,
    );

    expect(screen.getByText("107 total")).toBeTruthy();

    const bars = [...container.querySelectorAll<HTMLElement>(".bg-accent")];
    expect(bars).toHaveLength(2);
    // Tallest day (82 of 82) is full height; the 25-credit day is proportional, not 2px.
    const heights = bars.map((bar) => bar.style.height);
    expect(heights).toContain("100%");
    expect(heights).toContain("30%");
    expect(heights.some((height) => height === "2px")).toBe(false);
  });

  it("labels each bucket with its UTC day and credit figure", () => {
    const { container } = render(<SpendChart entries={settled(70, "2026-08-16T23:59:00.000Z")} />);
    expect(container.querySelector('[title="2026-08-16 · 70 credits"]')).not.toBeNull();
    expect(container.querySelector('[title="2026-08-17 · 0 credits"]')).not.toBeNull();
  });

  it("does NOT count a refunded reserve as spend", () => {
    const { container } = render(<SpendChart entries={refunded(40, "2026-08-16T09:00:00.000Z")} />);
    expect(screen.getByText("0 total")).toBeTruthy();
    expect(container.querySelectorAll(".bg-accent")).toHaveLength(0);
    expect(container.querySelector('[title="2026-08-16 · 0 credits"]')).not.toBeNull();
  });

  it("floors a net-negative day to the hairline but keeps the signed figure in tooltip + total", () => {
    const { container } = render(
      <SpendChart
        entries={[
          // Yesterday's reserve, refunded today: today nets -40 while yesterday keeps +40.
          ledgerRow({ kind: "spend_reserve", delta: -40, createdAt: "2026-08-16T09:00:00.000Z" }),
          ledgerRow({ kind: "spend_release", delta: 40, createdAt: "2026-08-17T09:00:00.000Z" }),
        ]}
      />,
    );
    expect(screen.getByText("0 total")).toBeTruthy();
    expect(container.querySelector('[title="2026-08-16 · 40 credits"]')).not.toBeNull();
    expect(container.querySelector('[title="2026-08-17 · -40 credits"]')).not.toBeNull();
    // The negative day is drawn AS the zero hairline — never as a bar with a negative height.
    const flats = [...container.querySelectorAll<HTMLElement>(".bg-hairline-soft")];
    expect(flats).toHaveLength(13);
    expect(flats.every((flat) => flat.style.height === "2px")).toBe(true);
  });

  it("renders 14 flat buckets and a 0 total when nothing in the window spent", () => {
    const { container } = render(
      <SpendChart
        entries={[
          ledgerRow({ kind: "grant", delta: 200, createdAt: "2026-08-16T09:00:00.000Z" }),
          ...settled(99, "2026-07-01T00:00:00.000Z"),
        ]}
      />,
    );
    expect(screen.getByText("0 total")).toBeTruthy();
    expect(container.querySelectorAll(".bg-hairline-soft")).toHaveLength(14);
    expect(container.querySelectorAll(".bg-accent")).toHaveLength(0);
  });
});

describe("SpendSparkline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("actually draws a rising step line for two or more settled spends", () => {
    const { container } = render(
      <SpendSparkline
        entries={[
          ...settled(30, "2026-08-10T00:00:00.000Z"),
          ...settled(90, "2026-08-16T00:00:00.000Z"),
        ]}
      />,
    );

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    // Start of band, first spend at 25% of the total, then the full band at the last spend.
    expect(polyline?.getAttribute("points")).toBe("0,4 0,4 0,10 120,10 120,29");
  });

  it("renders nothing when the window holds fewer than two spend rows", () => {
    const { container } = render(
      <SpendSparkline entries={settled(30, "2026-08-10T00:00:00.000Z")} />,
    );
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("steps back down when a spend is refunded, and nets the pair out", () => {
    const { container } = render(
      <SpendSparkline
        entries={[
          ...settled(30, "2026-08-10T00:00:00.000Z"),
          ...refunded(30, "2026-08-16T00:00:00.000Z"),
        ]}
      />,
    );
    // running: 30, 60, 30 against a peak of 60 — the last step goes back DOWN to the 30 level.
    expect(container.querySelector("polyline")?.getAttribute("points")).toBe(
      "0,4 0,4 0,17 120,17 120,29 120,29 120,17",
    );
  });

  it("renders nothing when the window holds only refunds (their reserves fell outside it)", () => {
    const { container } = render(
      <SpendSparkline
        entries={[
          ledgerRow({ kind: "spend_release", delta: 30, createdAt: "2026-08-10T00:00:00.000Z" }),
          ledgerRow({ kind: "spend_release", delta: 50, createdAt: "2026-08-16T00:00:00.000Z" }),
        ]}
      />,
    );
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("ignores spend older than the 30-day window", () => {
    const { container } = render(
      <SpendSparkline
        entries={[
          ...settled(30, "2026-06-01T00:00:00.000Z"),
          ...settled(90, "2026-08-16T00:00:00.000Z"),
        ]}
      />,
    );
    expect(container.querySelector("polyline")).toBeNull();
  });
});
