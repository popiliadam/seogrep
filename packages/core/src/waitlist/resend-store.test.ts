import { describe, expect, it } from "vitest";
import { createResendContactStore } from "./resend-store.js";

/**
 * M-14 — application-level deadlines for the Resend contact store.
 *
 * The store's BEHAVIOURAL specs (URLs, the 409 fallback, error mapping) live in
 * adapters.test.ts and are untouched; this file adds only the hang-protection contract,
 * which the store lacked entirely. Bare `fetch` has NO default timeout, so a Resend socket
 * held open would stall the waitlist request that is awaiting it. The sibling adapters —
 * email/send.ts and posthog-analytics.ts — already arm a 3s AbortSignal on every call;
 * these specs pin the same discipline here.
 *
 * Zero real network: every call goes through an injected fetch (constitution NEVER #5).
 */

const CONFIG = { apiKey: "re_test", segmentId: "seg_1" };
const SIGNUP = { email: "ada@example.com", source: "hero" };

/** A fetch that records its init and answers `status`/`body`. */
function recordingFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

/** A fetch that never resolves on its own; it settles only when the deadline aborts it. */
const hangingFetch = ((_url: string | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as unknown as typeof fetch;

describe("createResendContactStore request deadlines (M-14)", () => {
  it("arms a deadline on the contact POST", async () => {
    const { calls, fetchFn } = recordingFetch([{ status: 201, body: { id: "cont_1" } }]);
    await createResendContactStore({ ...CONFIG, fetchFn }).createContact(SIGNUP);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("arms a deadline on the 409 duplicate-lookup GET too", async () => {
    // The fallback read is a SECOND network call on the same request; leaving it
    // un-deadlined would move the hang rather than remove it.
    const { calls, fetchFn } = recordingFetch([
      { status: 409, body: { name: "conflict" } },
      { status: 200, body: { id: "cont_dup" } },
    ]);
    await createResendContactStore({ ...CONFIG, fetchFn }).createContact(SIGNUP);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a hung contact POST instead of stalling the waitlist request", async () => {
    const store = createResendContactStore({ ...CONFIG, fetchFn: hangingFetch, timeoutMs: 10 });
    await expect(store.createContact(SIGNUP)).rejects.toThrowError(/timeout|abort/i);
  });
});
