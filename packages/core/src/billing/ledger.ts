import { z } from "zod";

/**
 * Pure credit-ledger domain. No I/O, no clock, no randomness, no global state.
 * Mirrors the credit_ledger table (T1) but the DB layer (T3) is the only place
 * that persists, timestamps, and assigns identifiers.
 */

/** Entry kinds — mirror of the credit_ledger.kind CHECK constraint (T1). */
export const LEDGER_KINDS = [
  "grant",
  "purchase",
  "spend_reserve",
  "spend_commit",
  "spend_release",
  "adjust",
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

const positiveDelta = z.number().int().positive();
const negativeDelta = z.number().int().negative();
const reserveId = z.uuid();

/**
 * Sign rules (chef decision — resolves the brief conflict, authoritative):
 *   grant | purchase | spend_release => delta > 0
 *   spend_reserve                    => delta < 0
 *   spend_commit                     => delta = 0  (balance already dropped at reserve
 *                                                   time; commit is only a sign record)
 *   adjust                           => delta != 0 (bidirectional)
 *
 * reserveId is present only on the spend_* kinds; strict objects forbid it on the rest.
 */
export const ledgerEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("grant"), delta: positiveDelta }),
  z.strictObject({ kind: z.literal("purchase"), delta: positiveDelta }),
  z.strictObject({ kind: z.literal("spend_reserve"), delta: negativeDelta, reserveId }),
  z.strictObject({ kind: z.literal("spend_commit"), delta: z.literal(0), reserveId }),
  z.strictObject({ kind: z.literal("spend_release"), delta: positiveDelta, reserveId }),
  z.strictObject({
    kind: z.literal("adjust"),
    delta: z.number().int().refine((n) => n !== 0, "adjust delta must be non-zero"),
  }),
]);

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

/**
 * `balance` is the available (spendable) balance and equals Σ delta of the entries
 * applied so far. Reserved-but-not-settled amounts are held separately in
 * `openReserves` (reserveId -> reserved amount); the reserve entry already debited
 * `balance`, so committing settles it (no further change) and releasing refunds it.
 */
export interface LedgerState {
  readonly balance: number;
  readonly openReserves: ReadonlyMap<string, number>;
}

/** A fresh zero state — new Map each call, so callers never share mutable defaults. */
export function emptyState(): LedgerState {
  return { balance: 0, openReserves: new Map() };
}

/** Σ delta across entries — equals the available balance of `replay(entries)`. */
export function balanceOf(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.delta, 0);
}

/**
 * Fold one entry into the state, returning a NEW state (input is never mutated).
 * Throws on a malformed/sign-invalid entry (schema) or a broken invariant (domain):
 * negative balance, over-reserve, duplicate reserve, or double / mismatched close.
 */
export function applyEntry(state: LedgerState, raw: unknown): LedgerState {
  const entry = ledgerEntrySchema.parse(raw);
  switch (entry.kind) {
    case "grant":
    case "purchase":
      return { ...state, balance: state.balance + entry.delta };
    case "adjust":
      return applyAdjust(state, entry.delta);
    case "spend_reserve":
      return applyReserve(state, entry.reserveId, -entry.delta);
    case "spend_commit":
      return applyCommit(state, entry.reserveId);
    case "spend_release":
      return applyRelease(state, entry.reserveId, entry.delta);
  }
}

/** Replay entries left-to-right from an empty state; throws on the first invalid one. */
export function replay(entries: readonly unknown[]): LedgerState {
  return entries.reduce<LedgerState>((state, entry) => applyEntry(state, entry), emptyState());
}

function applyAdjust(state: LedgerState, delta: number): LedgerState {
  const balance = state.balance + delta;
  if (balance < 0) {
    throw new Error(
      `insufficient balance: adjust ${delta} would drive balance below zero (balance=${state.balance})`,
    );
  }
  return { ...state, balance };
}

function applyReserve(state: LedgerState, id: string, amount: number): LedgerState {
  if (state.openReserves.has(id)) {
    throw new Error(`duplicate reserve: reserveId ${id} is already open`);
  }
  if (state.balance < amount) {
    throw new Error(
      `insufficient balance: cannot reserve ${amount} (available ${state.balance})`,
    );
  }
  const openReserves = new Map(state.openReserves);
  openReserves.set(id, amount);
  return { balance: state.balance - amount, openReserves };
}

function applyCommit(state: LedgerState, id: string): LedgerState {
  if (!state.openReserves.has(id)) {
    throw new Error(`invalid commit: reserveId ${id} is not open`);
  }
  const openReserves = new Map(state.openReserves);
  openReserves.delete(id);
  return { ...state, openReserves };
}

function applyRelease(state: LedgerState, id: string, amount: number): LedgerState {
  const reserved = state.openReserves.get(id);
  if (reserved === undefined) {
    throw new Error(`invalid release: reserveId ${id} is not open`);
  }
  if (reserved !== amount) {
    throw new Error(
      `invalid release: amount ${amount} does not match reserved ${reserved} (full release only)`,
    );
  }
  const openReserves = new Map(state.openReserves);
  openReserves.delete(id);
  return { balance: state.balance + amount, openReserves };
}
