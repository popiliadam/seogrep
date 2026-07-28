import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKAGES } from "@pseo/core";

const captureSignup = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("../analytics", () => ({ captureSignup: (userId: string) => captureSignup(userId) }));

import { createServiceClient } from "@pseo/db/server";
import { ensureTrialGranted, grantTrialCredits } from "./trial";

const createServiceClientMock = vi.mocked(createServiceClient);

interface RpcResult {
  data: boolean | null;
  error: { message: string } | null;
}

/**
 * Minimal stand-in for the service client: grantTrialCredits now makes exactly ONE call —
 * `service.rpc("claim_trial", ...)` (the atomic migration-0009 RPC). The mock records the rpc
 * name + args so the test asserts them directly (closes Codex C-I1d, where the old lock-UPDATE
 * mock recorded no `.eq/.is` args).
 */
function mockClient(result: RpcResult) {
  const rpc = vi.fn().mockResolvedValue(result);
  const client = { rpc } as unknown as ReturnType<typeof createServiceClient>;
  return { client, rpc };
}

describe("grantTrialCredits", () => {
  afterEach(() => vi.clearAllMocks());

  it("calls claim_trial with the PINNED trial amount and returns true on a first-time grant", async () => {
    const { client, rpc } = mockClient({ data: true, error: null });
    createServiceClientMock.mockReturnValue(client);

    const granted = await grantTrialCredits("user-1");

    expect(granted).toBe(true); // true => THIS call flipped the lock; callback fires the funnel event.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("claim_trial", {
      p_user_id: "user-1",
      p_amount: CREDIT_PACKAGES.trial.credits, // amount from core — never a literal (NEVER #6).
    });
  });

  it("returns false on the idempotent already-granted no-op (claim_trial -> false)", async () => {
    const { client, rpc } = mockClient({ data: false, error: null });
    createServiceClientMock.mockReturnValue(client);

    const granted = await grantTrialCredits("user-1");

    expect(granted).toBe(false);
    expect(rpc).toHaveBeenCalledWith("claim_trial", {
      p_user_id: "user-1",
      p_amount: CREDIT_PACKAGES.trial.credits,
    });
  });

  it("throws when claim_trial errors — atomic rollback means the failure leaves NO partial state", async () => {
    // The web-level failure the RPC atomicity now makes safe: lock + grant are one transaction, so
    // an error here rolled BOTH back (no locked-but-creditless user). The caller may safely retry.
    const { client } = mockClient({ data: null, error: { message: "deadlock detected" } });
    createServiceClientMock.mockReturnValue(client);

    await expect(grantTrialCredits("user-1")).rejects.toThrow(
      /claim_trial failed: deadlock detected/,
    );
  });
});

interface FakeGrant {
  readonly user_id: string;
  readonly amount: number;
}

/**
 * Stateful stand-in for the migration-0009 `claim_trial` RPC. It mirrors the DB-side CAS the
 * real function performs in ONE transaction: the first caller to find `trial_granted_at IS NULL`
 * flips the lock AND appends the single trial row; every later caller sees the lock set and
 * returns false WITHOUT appending. Because the app can only reach the ledger through this RPC,
 * `grants` is a faithful stand-in for "trial rows in credit_ledger" — any retry path that could
 * double-grant shows up here as a second element.
 *
 * `failures` makes the first N calls raise (the transient DB error of M-21) so a retry can be
 * exercised against the SAME lock state.
 */
function mockClaimTrialDb(failures = 0) {
  const grants: FakeGrant[] = [];
  let remainingFailures = failures;
  let locked = false;
  const rpc = vi.fn(async (_name: string, args: { p_user_id: string; p_amount: number }) => {
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      // Atomic rollback: a failed claim leaves the lock untouched and appends nothing.
      return { data: null, error: { message: "deadlock detected" } };
    }
    if (locked) {
      return { data: false, error: null };
    }
    locked = true;
    grants.push({ user_id: args.p_user_id, amount: args.p_amount });
    return { data: true, error: null };
  });
  const client = { rpc } as unknown as ReturnType<typeof createServiceClient>;
  return { client, rpc, grants };
}

describe("ensureTrialGranted (M-21 — the creditless-account recovery path)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("grants once and fires the one-time signup event on the first authenticated entry", async () => {
    const { client, grants } = mockClaimTrialDb();
    createServiceClientMock.mockReturnValue(client);

    await ensureTrialGranted("user-1");

    expect(grants).toEqual([{ user_id: "user-1", amount: CREDIT_PACKAGES.trial.credits }]);
    expect(captureSignup).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("DOUBLE GRANT IS IMPOSSIBLE: repeated entries call claim_trial again but append exactly ONE trial row", async () => {
    const { client, rpc, grants } = mockClaimTrialDb();
    createServiceClientMock.mockReturnValue(client);

    // Every /app page view retries. Five entries, one ledger row.
    await ensureTrialGranted("user-1");
    await ensureTrialGranted("user-1");
    await ensureTrialGranted("user-1");
    await ensureTrialGranted("user-1");
    await ensureTrialGranted("user-1");

    expect(rpc).toHaveBeenCalledTimes(5); // the retry really did re-ask the DB...
    expect(grants).toHaveLength(1); // ...and the RPC's CAS refused every repeat.
    expect(grants[0]).toEqual({ user_id: "user-1", amount: CREDIT_PACKAGES.trial.credits });
    expect(captureSignup).toHaveBeenCalledExactlyOnceWith("user-1"); // funnel event once too.
  });

  it("concurrent entries (same user, parallel requests) still append exactly ONE trial row", async () => {
    const { client, grants } = mockClaimTrialDb();
    createServiceClientMock.mockReturnValue(client);

    await Promise.all([
      ensureTrialGranted("user-1"),
      ensureTrialGranted("user-1"),
      ensureTrialGranted("user-1"),
    ]);

    expect(grants).toHaveLength(1);
    expect(captureSignup).toHaveBeenCalledTimes(1);
  });

  it("recovers the M-21 victim: the callback's grant failed, the next entry grants — still once", async () => {
    // Call 1 = the auth callback, whose claim_trial hit a transient error (the one-time code is
    // burned by then). Call 2 = the user's next /app page view.
    const { client, grants } = mockClaimTrialDb(1);
    createServiceClientMock.mockReturnValue(client);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await ensureTrialGranted("user-1"); // fails, swallowed
    expect(grants).toHaveLength(0); // verified account, still creditless
    expect(errorSpy).toHaveBeenCalled();

    await ensureTrialGranted("user-1"); // retry on next entry

    expect(grants).toEqual([{ user_id: "user-1", amount: CREDIT_PACKAGES.trial.credits }]);
    expect(captureSignup).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("NEVER throws: a failing claim_trial must not break the page that called it", async () => {
    const { client } = mockClaimTrialDb(1);
    createServiceClientMock.mockReturnValue(client);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ensureTrialGranted("user-1")).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expect(captureSignup).not.toHaveBeenCalled();
  });

  it("does not re-fire the signup event when the trial was already granted", async () => {
    const { client } = mockClaimTrialDb();
    createServiceClientMock.mockReturnValue(client);
    await ensureTrialGranted("user-1"); // wins the lock
    captureSignup.mockClear();

    await ensureTrialGranted("user-1"); // idempotent no-op

    expect(captureSignup).not.toHaveBeenCalled();
  });
});
