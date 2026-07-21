import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end env proofs for the two web Supabase factories, driven through the REAL prod env
 * names (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY) via vi.stubEnv. A missing var
 * must make the factory throw (naming it) BEFORE constructing a client; when both are present the
 * factory wires the client with the exact url + anon key, unchanged from before (signed lesson
 * #5). @supabase/ssr and next/headers are mocked so the assertions observe the wiring directly.
 */

// vi.hoisted so these mocks initialize before the hoisted vi.mock factory closes over them.
const { createBrowserClient, createServerClient } = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ kind: "browser" })),
  createServerClient: vi.fn(() => ({ kind: "server" })),
}));
vi.mock("@supabase/ssr", () => ({ createBrowserClient, createServerClient }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: () => [], set: () => {} })),
}));

import { createClient as createBrowser } from "./client";
import { createClient as createServer } from "./server";

const URL = "https://project.supabase.co";
const ANON = "anon-key-value";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("web supabase browser factory (client.ts)", () => {
  it("throws naming NEXT_PUBLIC_SUPABASE_URL when it is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON);
    expect(() => createBrowser()).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("throws naming NEXT_PUBLIC_SUPABASE_ANON_KEY when it is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(() => createBrowser()).toThrowError(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(createBrowserClient).not.toHaveBeenCalled();
  });

  it("wires the client with the exact url + anon key when both are present", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON);
    const client = createBrowser();
    expect(createBrowserClient).toHaveBeenCalledWith(URL, ANON);
    expect(client).toEqual({ kind: "browser" });
  });
});

describe("web supabase server factory (server.ts)", () => {
  it("throws naming NEXT_PUBLIC_SUPABASE_URL when it is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON);
    await expect(createServer()).rejects.toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("throws naming NEXT_PUBLIC_SUPABASE_ANON_KEY when it is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    await expect(createServer()).rejects.toThrowError(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("wires the server client with the exact url + anon key when both are present", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON);
    const client = await createServer();
    expect(createServerClient).toHaveBeenCalledWith(
      URL,
      ANON,
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
    expect(client).toEqual({ kind: "server" });
  });
});
