import { afterEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKAGES } from "@pseo/core";

vi.mock("server-only", () => ({}));
vi.mock("@pseo/db/ledger-repo", () => ({ grantCredits: vi.fn() }));
vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn() }));

import { grantCredits } from "@pseo/db/ledger-repo";
import { createServiceClient } from "@pseo/db/server";
import { grantTrialCredits } from "./trial";

const grantCreditsMock = vi.mocked(grantCredits);
const createServiceClientMock = vi.mocked(createServiceClient);

interface UpdateResult {
  data: { id: string }[] | null;
  error: { message: string } | null;
}

/** Minimal chainable stand-in for the service client used by grantTrialCredits. */
function mockClient(updateResult: UpdateResult) {
  const builder = {
    eq: () => builder,
    is: () => builder,
    select: () => Promise.resolve(updateResult),
  };
  return {
    from: () => ({
      upsert: () => Promise.resolve({ error: null }),
      update: () => builder,
    }),
  } as unknown as ReturnType<typeof createServiceClient>;
}

describe("grantTrialCredits", () => {
  afterEach(() => vi.clearAllMocks());

  it("grants the trial package exactly once when the lock flips NULL -> now", async () => {
    createServiceClientMock.mockReturnValue(mockClient({ data: [{ id: "user-1" }], error: null }));
    await grantTrialCredits("user-1");
    expect(grantCreditsMock).toHaveBeenCalledTimes(1);
    expect(grantCreditsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        kind: "grant",
        amount: CREDIT_PACKAGES.trial.credits,
        reason: "trial",
      }),
    );
  });

  it("does not grant when trial_granted_at is already set (no row returned)", async () => {
    createServiceClientMock.mockReturnValue(mockClient({ data: [], error: null }));
    await grantTrialCredits("user-1");
    expect(grantCreditsMock).not.toHaveBeenCalled();
  });
});
