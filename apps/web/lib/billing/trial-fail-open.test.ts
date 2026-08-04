import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKAGES } from "@pseo/core";

const captureSignup = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("../analytics", () => ({ captureSignup: (userId: string) => captureSignup(userId) }));

import { createServiceClient } from "@pseo/db/server";
import { ensureTrialGranted, grantTrialCredits } from "./trial";

const createServiceClientMock = vi.mocked(createServiceClient);
const TRIAL = CREDIT_PACKAGES.trial.credits;

/**
 * FAIL OPEN — the governing asymmetry of the whole H-06 slice.
 *
 * Refusing a legitimate verified user the 200 credits the site advertises is a WORSE failure
 * than granting one extra trial. So whenever the address is missing, or `trialEmailIdentity`
 * cannot parse it confidently, the caller must fall back to the literal 0009 two-argument body
 * and the trial must be granted exactly as it was before the mailbox dimension existed.
 *
 * These cases need no mailbox model — a taken fingerprint is not what is under test. What is
 * under test is that NO fingerprint is asserted at all, and that the grant still happens.
 */
function mockGrantingRpc() {
  const grants: { user_id: string; amount: number }[] = [];
  const granted = new Set<string>();
  const rpc = vi.fn(async (_name: string, args: { p_user_id: string; p_amount: number }) => {
    if (granted.has(args.p_user_id)) return { data: false, error: null };
    granted.add(args.p_user_id);
    grants.push({ user_id: args.p_user_id, amount: args.p_amount });
    return { data: true, error: null };
  });
  const client = { rpc } as unknown as ReturnType<typeof createServiceClient>;
  return { client, rpc, grants };
}

/** Inputs `trialEmailIdentity` answers `null` for, plus the absent-address cases. */
const UNUSABLE: readonly (string | null | undefined)[] = [
  null,
  undefined,
  "",
  "   ",
  "no-at-sign",
  "@example.com", // empty local part
  "person@", // empty domain
];

describe("H-06 fail-open: no usable address still grants the advertised trial", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it.each(UNUSABLE)("still grants when the address is %j", async (email) => {
    const { client, rpc, grants } = mockGrantingRpc();
    createServiceClientMock.mockReturnValue(client);

    const result = await grantTrialCredits("uid-a", email ?? null);

    expect(result).toBe(true);
    expect(grants).toEqual([{ user_id: "uid-a", amount: TRIAL }]);
    // The literal 0009 body — no fingerprint key at all, so the RPC skips the mailbox branch.
    expect(rpc).toHaveBeenCalledWith("claim_trial", { p_user_id: "uid-a", p_amount: TRIAL });
  });

  it("NEVER sends an empty-string fingerprint (that would claim the '' mailbox for everyone)", async () => {
    // 0020 treats '' as absent, but sending it would still be the caller asserting a mailbox
    // identity it does not have — and a stricter future DB could take it literally.
    const { client, rpc } = mockGrantingRpc();
    createServiceClientMock.mockReturnValue(client);

    for (const email of UNUSABLE) {
      await grantTrialCredits("uid-x", email ?? null);
    }

    for (const call of rpc.mock.calls) {
      expect(call[1]).not.toHaveProperty("p_email_fingerprint");
      expect(call[1]).not.toHaveProperty("p_email_domain");
    }
  });

  it("two unparseable-address users BOTH get their trial (no accidental merge on '')", async () => {
    const { client, grants } = mockGrantingRpc();
    createServiceClientMock.mockReturnValue(client);

    await ensureTrialGranted("uid-a", "no-at-sign");
    await ensureTrialGranted("uid-b", null);

    expect(grants).toHaveLength(2);
    expect(grants.reduce((sum, grant) => sum + grant.amount, 0)).toBe(TRIAL * 2);
  });

  it("a whitespace-only address does not throw and does not skip the claim", async () => {
    const { client, grants } = mockGrantingRpc();
    createServiceClientMock.mockReturnValue(client);

    await expect(ensureTrialGranted("uid-a", "   ")).resolves.toBeUndefined();

    expect(grants).toEqual([{ user_id: "uid-a", amount: TRIAL }]);
    expect(captureSignup).toHaveBeenCalledExactlyOnceWith("uid-a");
  });
});
