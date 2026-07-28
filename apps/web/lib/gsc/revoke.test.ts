// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { revokeGoogleToken } from "./revoke";

/**
 * The revoke helper is the one place the disconnect path touches Google. Every spec here
 * injects `fetch` — no real request is ever made (constitution NEVER #5) — and pins the
 * two halves of the contract: the request Google documents (POST, form-encoded `token`),
 * and the best-effort promise that a failure NEVER escapes as a throw (the caller's local
 * deletion must not be blocked by Google being down or the token already being dead).
 */

function okResponse(): Response {
  return new Response("", { status: 200 });
}

describe("revokeGoogleToken", () => {
  it("POSTs the token form-encoded to Google's revoke endpoint", async () => {
    const doFetch = vi.fn().mockResolvedValue(okResponse());

    const acknowledged = await revokeGoogleToken("1//the-refresh-token", { fetch: doFetch });

    expect(acknowledged).toBe(true);
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [url, init] = doFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(new URLSearchParams(init.body as string).get("token")).toBe("1//the-refresh-token");
  });

  it("returns false WITHOUT throwing when Google rejects the token (already dead)", async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "invalid_token" }), { status: 400 }));

    await expect(revokeGoogleToken("dead-token", { fetch: doFetch })).resolves.toBe(false);
  });

  it("returns false WITHOUT throwing when the request itself fails (network down)", async () => {
    const doFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(revokeGoogleToken("some-token", { fetch: doFetch })).resolves.toBe(false);
  });

  it("returns false WITHOUT throwing on a Google 5xx", async () => {
    const doFetch = vi.fn().mockResolvedValue(new Response("", { status: 503 }));

    await expect(revokeGoogleToken("some-token", { fetch: doFetch })).resolves.toBe(false);
  });
});
