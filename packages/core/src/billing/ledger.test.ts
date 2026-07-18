import { describe, expect, it } from "vitest";
import { applyEntry, balanceOf, emptyState, ledgerEntrySchema, replay } from "./ledger.js";
import { CREDIT_PACKAGES } from "./packages.js";

// Valid RFC 4122 v4 UUIDs (version nibble 4, variant nibble 8) — accepted by z.uuid().
const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";

describe("ledger sign rules (schema)", () => {
  it("rejects grant with a non-positive delta", () => {
    expect(() => applyEntry(emptyState(), { kind: "grant", delta: -5 })).toThrow();
    expect(() => applyEntry(emptyState(), { kind: "grant", delta: 0 })).toThrow();
  });

  it("rejects spend_reserve with a non-negative delta", () => {
    expect(() =>
      applyEntry(emptyState(), { kind: "spend_reserve", delta: 5, reserveId: R1 }),
    ).toThrow();
  });

  it("rejects spend_commit with a non-zero delta", () => {
    expect(() =>
      applyEntry(emptyState(), { kind: "spend_commit", delta: -1, reserveId: R1 }),
    ).toThrow();
  });

  it("rejects adjust with a zero delta", () => {
    expect(() => applyEntry(emptyState(), { kind: "adjust", delta: 0 })).toThrow();
  });

  it("rejects a reserveId on non-spend kinds (strict object)", () => {
    expect(() =>
      applyEntry(emptyState(), { kind: "grant", delta: 5, reserveId: R1 }),
    ).toThrow();
  });

  it("rejects spend kinds that are missing a reserveId", () => {
    expect(() => applyEntry(emptyState(), { kind: "spend_reserve", delta: -5 })).toThrow();
  });
});

describe("ledger domain rules", () => {
  it("grant and purchase increase the balance", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    expect(s.balance).toBe(100);
    s = applyEntry(s, { kind: "purchase", delta: 50 });
    expect(s.balance).toBe(150);
  });

  it("reserve holds funds and reduces the available balance", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    s = applyEntry(s, { kind: "spend_reserve", delta: -30, reserveId: R1 });
    expect(s.balance).toBe(70);
    expect(s.openReserves.get(R1)).toBe(30);
  });

  it("rejects a reserve that exceeds the available balance", () => {
    const s = applyEntry(emptyState(), { kind: "grant", delta: 20 });
    expect(() =>
      applyEntry(s, { kind: "spend_reserve", delta: -50, reserveId: R1 }),
    ).toThrow(/insufficient balance/);
  });

  it("commit closes the reserve with delta 0 and keeps the balance", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    s = applyEntry(s, { kind: "spend_reserve", delta: -30, reserveId: R1 });
    s = applyEntry(s, { kind: "spend_commit", delta: 0, reserveId: R1 });
    expect(s.balance).toBe(70);
    expect(s.openReserves.has(R1)).toBe(false);
  });

  it("release returns the reserved funds to the balance", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    s = applyEntry(s, { kind: "spend_reserve", delta: -30, reserveId: R1 });
    s = applyEntry(s, { kind: "spend_release", delta: 30, reserveId: R1 });
    expect(s.balance).toBe(100);
    expect(s.openReserves.has(R1)).toBe(false);
  });

  it("rejects a release whose amount does not match the reserve (no partial release)", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    s = applyEntry(s, { kind: "spend_reserve", delta: -30, reserveId: R1 });
    expect(() =>
      applyEntry(s, { kind: "spend_release", delta: 20, reserveId: R1 }),
    ).toThrow(/does not match/);
  });

  it("rejects double commit and commit-then-release (single close, XOR)", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    s = applyEntry(s, { kind: "spend_reserve", delta: -30, reserveId: R1 });
    const committed = applyEntry(s, { kind: "spend_commit", delta: 0, reserveId: R1 });
    expect(() =>
      applyEntry(committed, { kind: "spend_commit", delta: 0, reserveId: R1 }),
    ).toThrow(/not open/);
    expect(() =>
      applyEntry(committed, { kind: "spend_release", delta: 30, reserveId: R1 }),
    ).toThrow(/not open/);
  });

  it("rejects double release", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    s = applyEntry(s, { kind: "spend_reserve", delta: -30, reserveId: R1 });
    const released = applyEntry(s, { kind: "spend_release", delta: 30, reserveId: R1 });
    expect(() =>
      applyEntry(released, { kind: "spend_release", delta: 30, reserveId: R1 }),
    ).toThrow(/not open/);
  });

  it("rejects commit or release on an unknown reserve", () => {
    const s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    expect(() =>
      applyEntry(s, { kind: "spend_commit", delta: 0, reserveId: R2 }),
    ).toThrow(/not open/);
    expect(() =>
      applyEntry(s, { kind: "spend_release", delta: 10, reserveId: R2 }),
    ).toThrow(/not open/);
  });

  it("rejects reserving an already-open reserveId", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    s = applyEntry(s, { kind: "spend_reserve", delta: -30, reserveId: R1 });
    expect(() =>
      applyEntry(s, { kind: "spend_reserve", delta: -10, reserveId: R1 }),
    ).toThrow(/already open/);
  });

  it("adjust moves the balance both ways but never below zero", () => {
    let s = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    s = applyEntry(s, { kind: "adjust", delta: -40 });
    expect(s.balance).toBe(60);
    s = applyEntry(s, { kind: "adjust", delta: 25 });
    expect(s.balance).toBe(85);
    expect(() => applyEntry(s, { kind: "adjust", delta: -1000 })).toThrow(
      /insufficient balance/,
    );
  });

  it("does not mutate the input state (immutability)", () => {
    const base = applyEntry(emptyState(), { kind: "grant", delta: 100 });
    const reserved = applyEntry(base, { kind: "spend_reserve", delta: -30, reserveId: R1 });
    expect(base.balance).toBe(100);
    expect(base.openReserves.size).toBe(0);
    expect(reserved.balance).toBe(70);
  });
});

describe("balanceOf and replay", () => {
  it("balanceOf sums deltas and equals the replay balance", () => {
    const entries = [
      { kind: "grant", delta: 100 },
      { kind: "spend_reserve", delta: -30, reserveId: R1 },
      { kind: "spend_commit", delta: 0, reserveId: R1 },
    ];
    const state = replay(entries);
    expect(state.balance).toBe(70);
    expect(balanceOf(entries.map((e) => ledgerEntrySchema.parse(e)))).toBe(70);
  });

  it("replay throws on an invalid sequence", () => {
    const entries = [
      { kind: "grant", delta: 100 },
      { kind: "spend_reserve", delta: -300, reserveId: R1 }, // exceeds balance
    ];
    expect(() => replay(entries)).toThrow(/insufficient balance/);
  });
});

describe("CREDIT_PACKAGES pin (NEVER #6 human-approval gate)", () => {
  it("matches the approved literals exactly", () => {
    expect(CREDIT_PACKAGES).toEqual({
      trial: { credits: 200, oneTime: true },
      starter: { credits: 1_000, oneTime: false },
      pro: { credits: 3_500, oneTime: false },
      agency: { credits: 12_000, oneTime: false },
      topup_10: { credits: 400, oneTime: true },
      topup_25: { credits: 1_100, oneTime: true },
      topup_50: { credits: 2_400, oneTime: true },
    });
  });
});
