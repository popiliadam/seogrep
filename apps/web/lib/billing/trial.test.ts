import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKAGES } from "@pseo/core";

vi.mock("server-only", () => ({}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn() }));

import { createServiceClient } from "@pseo/db/server";
import { grantTrialCredits } from "./trial";

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
