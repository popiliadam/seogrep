import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const redirect = vi.fn();
const ensureTrialGranted = vi.fn();

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../../lib/billing/trial", () => ({
  ensureTrialGranted: (userId: string) => ensureTrialGranted(userId),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/link", () => ({ default: (props: { children?: unknown }) => props.children }));

import AppLayout from "./layout";

describe("AppLayout guard", () => {
  afterEach(() => vi.clearAllMocks());

  it("redirects to /login when there is no authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await AppLayout({ children: null });
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("does not redirect when a user is present", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    await AppLayout({ children: null });
    expect(redirect).not.toHaveBeenCalled();
  });

  // M-21: the auth callback is single-use, so a trial grant that failed there can only be
  // recovered on a later authenticated entry. This guard runs on EVERY /app page, and the claim
  // is idempotent (migration-0009 CAS), so re-asking cannot double-grant.
  it("retries the idempotent trial claim for the authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    await AppLayout({ children: null });
    expect(ensureTrialGranted).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("does not touch the trial claim when there is no authenticated user", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await AppLayout({ children: null });
    expect(ensureTrialGranted).not.toHaveBeenCalled();
  });
});
