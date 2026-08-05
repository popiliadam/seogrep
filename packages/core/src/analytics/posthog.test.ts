import { describe, expect, it } from "vitest";
import { createPostHogAnalytics } from "./posthog.js";

/**
 * Carried over verbatim from the deleted `waitlist/adapters.test.ts`, minus the
 * createResendContactStore half — that adapter really was waitlist-only and went with it.
 * These four did not: they cover the adapter behind signup / key-created / purchase analytics.
 * Event names updated from the old waitlist_signup fixture to the events that actually ship.
 */
function fetchStub(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("createPostHogAnalytics", () => {
  it("POSTs capture with api key, event, distinct_id and properties", async () => {
    const { calls, fetchFn } = fetchStub([{ status: 200, body: { status: 1 } }]);
    const analytics = createPostHogAnalytics({ apiKey: "phc_test", fetchFn });
    await analytics.capture({ name: "purchase_completed", distinctId: "abc", properties: { package: "starter" } });
    expect(calls[0].url).toBe("https://eu.i.posthog.com/capture/");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "purchase_completed",
      distinct_id: "abc",
      properties: { package: "starter" },
    });
  });

  it("throws on non-2xx so the safeCapture wrapper can swallow and log", async () => {
    const { fetchFn } = fetchStub([{ status: 500, body: {} }]);
    const analytics = createPostHogAnalytics({ apiKey: "phc_test", fetchFn });
    await expect(analytics.capture({ name: "e", distinctId: "d" })).rejects.toThrow(
      /PostHog capture failed \(500\)/,
    );
  });

  it("arms a default 3s abort signal on every capture call (hang protection always on)", async () => {
    const { calls, fetchFn } = fetchStub([{ status: 200, body: { status: 1 } }]);
    const analytics = createPostHogAnalytics({ apiKey: "phc_test", fetchFn });
    await analytics.capture({ name: "e", distinctId: "d" });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a hung capture after timeoutMs and rejects (best-effort callers can catch it)", async () => {
    const fetchFn = ((_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const analytics = createPostHogAnalytics({ apiKey: "phc_test", fetchFn, timeoutMs: 10 });
    await expect(analytics.capture({ name: "e", distinctId: "d" })).rejects.toThrow(/timeout|aborted/i);
  });
});
