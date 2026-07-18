import { afterEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const redirect = vi.fn();

vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
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
});
