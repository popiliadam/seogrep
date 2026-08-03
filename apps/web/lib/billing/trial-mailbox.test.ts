import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKAGES, trialEmailIdentity } from "@pseo/core";

const captureSignup = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("../analytics", () => ({ captureSignup: (userId: string) => captureSignup(userId) }));

import { createServiceClient } from "@pseo/db/server";
import { ensureTrialGranted, grantTrialCredits } from "./trial";

const createServiceClientMock = vi.mocked(createServiceClient);
const TRIAL = CREDIT_PACKAGES.trial.credits;

interface ClaimTrialArgs {
  readonly p_user_id: string;
  readonly p_amount: number;
  readonly p_email_fingerprint?: string;
}

interface Grant {
  readonly user_id: string;
  readonly amount: number;
}

/**
 * Faithful stand-in for `claim_trial` AFTER migration 0020 — both dimensions, in the order the
 * SQL runs them (0020:119-167); transcribed, not paraphrased, since a fake that mis-modelled
 * the mailbox branch could show green against a caller that still sends nothing.
 *
 *   1. mailbox claim FIRST (`insert ... on conflict do nothing`) — a taken fingerprint returns
 *      false WITHOUT touching the per-uid lock or the ledger. That ordering is 0020's whole
 *      correctness argument: refusing after the lock would commit the locked-but-creditless
 *      state 0009 exists to make unreachable;
 *   2. then the 0009 per-uid CAS — the first caller flips the lock and appends ONE ledger row.
 *
 * An absent OR EMPTY fingerprint skips step 1: the 0009 convention the fail-open path produces.
 * `grants` stands in for the trial rows in credit_ledger — the app reaches the ledger only
 * through this RPC, so any double-grant surfaces here as a second element.
 */
function mockClaimTrial0020() {
  const grants: Grant[] = [];
  const mailboxes = new Map<string, string>(); // fingerprint -> uid holding it
  const locked = new Set<string>();

  const rpc = vi.fn(async (_name: string, args: ClaimTrialArgs) => {
    const fingerprint = args.p_email_fingerprint;
    if (fingerprint !== undefined && fingerprint !== null && fingerprint !== "") {
      if (mailboxes.has(fingerprint)) return { data: false, error: null }; // no lock, no row.
      mailboxes.set(fingerprint, args.p_user_id);
    }
    if (locked.has(args.p_user_id)) return { data: false, error: null }; // already granted.
    locked.add(args.p_user_id);
    grants.push({ user_id: args.p_user_id, amount: args.p_amount });
    return { data: true, error: null };
  });

  const client = { rpc } as unknown as ReturnType<typeof createServiceClient>;
  const credits = () => grants.reduce((sum, grant) => sum + grant.amount, 0);
  return { client, rpc, grants, locked, credits };
}

/**
 * H-06 — the caller-wiring slice. 0020 gave `claim_trial` a mailbox dimension and packages/core
 * computes the fingerprint, but apps/web kept issuing the TWO-argument call, so the dimension
 * was dormant and two accounts on one real inbox each received 200 credits. These drive the
 * REAL caller; `packages/db/src/claim-trial.db.test.ts` proves the DB half on a live stack.
 */
describe("H-06: the mailbox dimension is LIVE through the real caller", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("two uids on plus-aliased forms of ONE mailbox receive exactly ONE trial (200, not 400)", async () => {
    const { client, grants, credits } = mockClaimTrial0020();
    createServiceClientMock.mockReturnValue(client);

    // The audit's exact technique: RFC 5233 sub-addressing mints a new uid for free.
    await ensureTrialGranted("uid-a", "redteam.h06@gmail.com");
    await ensureTrialGranted("uid-b", "redteam.h06+free2@gmail.com");

    expect(grants).toEqual([{ user_id: "uid-a", amount: TRIAL }]);
    expect(credits()).toBe(TRIAL); // 200 — NOT 400.
    expect(captureSignup).toHaveBeenCalledExactlyOnceWith("uid-a"); // funnel event once.
  });

  it("folds gmail dots too, and sends packages/core's fingerprint — not a re-implementation", async () => {
    const { client, rpc, grants } = mockClaimTrial0020();
    createServiceClientMock.mockReturnValue(client);

    await ensureTrialGranted("uid-a", "red.team.h06@gmail.com");
    await ensureTrialGranted("uid-b", "redteamh06+x@googlemail.com"); // alias domain + dots + plus

    expect(grants).toHaveLength(1);
    // The caller must not carry its own copy of the normalising rules: what it sends has to be
    // byte-identical to what packages/core computes for that address.
    const expected = trialEmailIdentity("red.team.h06@gmail.com");
    expect(expected).not.toBeNull();
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_user_id: "uid-a",
      p_amount: TRIAL,
      p_email_fingerprint: expected?.fingerprint,
      p_email_domain: "gmail.com",
      p_disposable_domain: false,
    });
  });

  it("leaves the REFUSED user claimable later — not locked, not creditless", async () => {
    // 0020 takes the mailbox claim BEFORE the lock, so a refusal leaves the second uid exactly
    // as it found it. Proof: that same uid can still claim on a mailbox of its own.
    const { client, grants, locked, credits } = mockClaimTrial0020();
    createServiceClientMock.mockReturnValue(client);

    await ensureTrialGranted("uid-a", "shared.box@gmail.com");
    await ensureTrialGranted("uid-b", "shared.box+alias@gmail.com"); // refused

    expect(locked.has("uid-b")).toBe(false); // no lock flipped...
    expect(grants.some((grant) => grant.user_id === "uid-b")).toBe(false); // ...and no credits.

    // The refusal was about the MAILBOX, never the person: uid-b remains claimable.
    await ensureTrialGranted("uid-b", "different.person@outlook.com");

    expect(grants.map((grant) => grant.user_id)).toEqual(["uid-a", "uid-b"]);
    expect(credits()).toBe(TRIAL * 2);
  });

  it("does NOT merge two different real people (the false-positive direction)", async () => {
    // Denying a legitimate verified user their advertised 200 is the worse failure, so dots are
    // folded ONLY where the provider ignores them. On outlook they are significant.
    const { client, grants, credits } = mockClaimTrial0020();
    createServiceClientMock.mockReturnValue(client);

    await ensureTrialGranted("uid-a", "john.smith@outlook.com");
    await ensureTrialGranted("uid-b", "johnsmith@outlook.com");

    expect(grants).toHaveLength(2);
    expect(credits()).toBe(TRIAL * 2);
  });

  it("records the disposable signal and STILL grants — signal, never a gate", async () => {
    const { client, rpc, grants } = mockClaimTrial0020();
    createServiceClientMock.mockReturnValue(client);

    const granted = await grantTrialCredits("uid-a", "throwaway@mailinator.com");

    expect(granted).toBe(true); // NOT denied.
    expect(grants).toHaveLength(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_email_domain: "mailinator.com",
      p_disposable_domain: true,
    });
  });
});
