import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyEntry,
  balanceOf,
  emptyState,
  replay,
  type LedgerEntry,
  type LedgerState,
} from "./ledger.js";

// Fixed seeds — deterministic & reproducible (recorded in task-2-report.md).
const SEED_1 = 0xf00d; // property 1: balance === Σdelta, balance >= 0
const SEED_2 = 0xbeef; // property 2: one commit XOR release per reserve
const SEED_3 = 0xcafe; // property 3: an invalid command makes replay throw

interface StepSeed {
  readonly bucket: number;
  readonly amount: number;
  readonly pick: number;
  readonly close: boolean;
  readonly reserveId: string;
}

const stepArb: fc.Arbitrary<StepSeed> = fc.record({
  bucket: fc.integer({ min: 0, max: 99 }),
  amount: fc.integer({ min: 1, max: 1000 }),
  pick: fc.integer({ min: 0, max: 1_000_000 }),
  close: fc.boolean(),
  reserveId: fc.uuid(),
});

/**
 * State-aware: turns a raw seed into a VALID ledger entry given the current state,
 * so every produced entry applies cleanly. Falls back to `grant` (always valid)
 * when the drawn action is not currently possible.
 */
function deriveEntry(state: LedgerState, seed: StepSeed): LedgerEntry {
  const { bucket, amount, pick, close, reserveId } = seed;
  const balance = state.balance;
  const openIds = [...state.openReserves.keys()];

  if (bucket < 30) return { kind: "grant", delta: amount };
  if (bucket < 45) return { kind: "purchase", delta: amount };

  if (bucket < 62) {
    if (balance >= 1 && !state.openReserves.has(reserveId)) {
      const amt = 1 + (pick % balance); // 1..balance  => reserve always fits
      return { kind: "spend_reserve", delta: -amt, reserveId };
    }
    return { kind: "grant", delta: amount };
  }

  if (bucket < 80) {
    if (openIds.length > 0) {
      const id = openIds[pick % openIds.length];
      const reserved = id === undefined ? undefined : state.openReserves.get(id);
      if (id !== undefined && reserved !== undefined) {
        return close
          ? { kind: "spend_commit", delta: 0, reserveId: id }
          : { kind: "spend_release", delta: reserved, reserveId: id };
      }
    }
    return { kind: "grant", delta: amount };
  }

  if (close) return { kind: "adjust", delta: amount }; // positive
  if (balance >= 1) return { kind: "adjust", delta: -(1 + (pick % balance)) }; // negative, within balance
  return { kind: "adjust", delta: amount };
}

/** Replay seeds into a valid, applied sequence of entries. */
function buildValidSequence(seeds: readonly StepSeed[]): LedgerEntry[] {
  let state = emptyState();
  const applied: LedgerEntry[] = [];
  for (const seed of seeds) {
    const entry = deriveEntry(state, seed);
    state = applyEntry(state, entry);
    applied.push(entry);
  }
  return applied;
}

// A schema-invalid entry: rejected regardless of state/position, so replay must throw.
const invalidEntryArb = fc.oneof(
  fc.record({ kind: fc.constant("grant"), delta: fc.integer({ min: -1000, max: 0 }) }),
  fc.record({
    kind: fc.constant("spend_reserve"),
    delta: fc.integer({ min: 0, max: 1000 }),
    reserveId: fc.uuid(),
  }),
  fc.record({
    kind: fc.constant("spend_commit"),
    delta: fc.integer({ min: 1, max: 1000 }),
    reserveId: fc.uuid(),
  }),
  fc.record({ kind: fc.constant("adjust"), delta: fc.constant(0) }),
  fc.record({ kind: fc.constant("not_a_real_kind"), delta: fc.integer() }),
);

const thousandSteps = fc.array(stepArb, { minLength: 1000, maxLength: 1000 });

describe("ledger property: balance always equals Σdelta and never goes negative", () => {
  const property = fc.property(thousandSteps, (seeds) => {
    let state = emptyState();
    const applied: LedgerEntry[] = [];
    let runningSum = 0; // incremental balanceOf(applied)
    for (const seed of seeds) {
      const entry = deriveEntry(state, seed);
      state = applyEntry(state, entry);
      applied.push(entry);
      runningSum += entry.delta;
      if (state.balance !== runningSum) return false;
      if (state.balance < 0) return false;
    }
    // Cross-check the real balanceOf over the full 1000-entry sequence.
    return balanceOf(applied) === state.balance;
  });

  it("holds over 1000-operation sequences (default 100 runs)", { timeout: 60_000 }, () => {
    fc.assert(property, { seed: SEED_1 });
  });

  it("holds over 1000-operation sequences (numRuns: 250)", { timeout: 60_000 }, () => {
    fc.assert(property, { seed: SEED_1, numRuns: 250 });
  });
});

describe("ledger property: each reserve gets at most one commit XOR release", () => {
  it("a second close of any kind is always rejected", { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.boolean(),
        fc.uuid(),
        (grant, reserve, viaCommit, id) => {
          fc.pre(reserve <= grant); // reserve must fit the balance
          let s = emptyState();
          s = applyEntry(s, { kind: "grant", delta: grant });
          s = applyEntry(s, { kind: "spend_reserve", delta: -reserve, reserveId: id });
          const closed = applyEntry(
            s,
            viaCommit
              ? { kind: "spend_commit", delta: 0, reserveId: id }
              : { kind: "spend_release", delta: reserve, reserveId: id },
          );
          // Once closed, neither a commit nor a release may be applied again.
          expect(() =>
            applyEntry(closed, { kind: "spend_commit", delta: 0, reserveId: id }),
          ).toThrow(/not open/);
          expect(() =>
            applyEntry(closed, { kind: "spend_release", delta: reserve, reserveId: id }),
          ).toThrow(/not open/);
        },
      ),
      { seed: SEED_2, numRuns: 250 },
    );
  });
});

describe("ledger property: one invalid command makes the whole replay throw", () => {
  it("inserting a schema-invalid entry anywhere causes replay to throw", { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 0, maxLength: 40 }),
        fc.nat(),
        invalidEntryArb,
        (seeds, indexRaw, invalid) => {
          const validRaw: unknown[] = buildValidSequence(seeds);
          const index = indexRaw % (validRaw.length + 1);
          const corrupted = [...validRaw.slice(0, index), invalid, ...validRaw.slice(index)];
          expect(() => replay(corrupted)).toThrow();
        },
      ),
      { seed: SEED_3, numRuns: 250 },
    );
  });
});
