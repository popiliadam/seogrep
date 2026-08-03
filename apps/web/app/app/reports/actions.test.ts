// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// Action deps are mocked: no real service-role client, no live DB. These specs pin the two
// security invariants — session required, ownership enforced — and the opaque error surface.
// The UPDATE's own tenant filter is proved against a row-backed fake in lib/reports.test.ts.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const revokeReportLink = vi.fn();
vi.mock("../../../lib/reports", () => ({
  revokeReportLink: (...args: unknown[]) => revokeReportLink(...args),
}));

const getUser = vi.fn();
vi.mock("../../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import { revalidatePath } from "next/cache";
import { revokeReportLinkAction } from "./actions";

const REPORT = "11111111-1111-4111-8111-111111111111";

function signedIn(userId: string) {
  getUser.mockResolvedValue({ data: { user: { id: userId } } });
}
function signedOut() {
  getUser.mockResolvedValue({ data: { user: null } });
}

afterEach(() => vi.resetAllMocks());

describe("revokeReportLinkAction (L-13)", () => {
  it("rejects with no session and never writes", async () => {
    signedOut();
    await expect(revokeReportLinkAction(REPORT)).rejects.toThrow(/not authenticated/i);
    expect(revokeReportLink).not.toHaveBeenCalled();
  });

  it("revokes for the SESSION user — never an id the client supplied", async () => {
    signedIn("user-1");
    revokeReportLink.mockResolvedValue(true);

    await expect(revokeReportLinkAction(REPORT)).resolves.toBeUndefined();

    expect(revokeReportLink).toHaveBeenCalledWith({ userId: "user-1", reportId: REPORT });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/app/reports");
  });

  it("rejects a malformed report id without touching the database", async () => {
    signedIn("user-1");
    await expect(revokeReportLinkAction("not-a-uuid")).rejects.toThrow(/not found/i);
    expect(revokeReportLink).not.toHaveBeenCalled();
  });

  it("cannot revoke ANOTHER user's report: opaque error, nothing revalidated", async () => {
    signedIn("user-1");
    // What the tenant-filtered UPDATE reports for a report user-1 does not own — the same
    // `false` a missing id produces, so the two are indistinguishable from outside.
    revokeReportLink.mockResolvedValue(false);

    await expect(revokeReportLinkAction(REPORT)).rejects.toThrow(/not found/i);

    expect(revokeReportLink).toHaveBeenCalledWith({ userId: "user-1", reportId: REPORT });
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("answers an unknown report the SAME way as a foreign one — nothing leaks", async () => {
    signedIn("user-1");
    revokeReportLink.mockResolvedValue(false);
    const unknown = "22222222-2222-4222-8222-222222222222";

    const foreign = await revokeReportLinkAction(REPORT).catch((error: Error) => error.message);
    const missing = await revokeReportLinkAction(unknown).catch((error: Error) => error.message);
    expect(missing).toBe(foreign);
  });

  it("surfaces a failed revoke instead of reporting success", async () => {
    signedIn("user-1");
    revokeReportLink.mockRejectedValue(new Error("revokeReportLink failed: db down"));

    await expect(revokeReportLinkAction(REPORT)).rejects.toThrow(/db down/);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });
});
