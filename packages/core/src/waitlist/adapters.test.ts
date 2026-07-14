import { describe, expect, it } from "vitest";
import { createResendContactStore } from "./resend-store.js";
import { createPostHogAnalytics } from "./posthog-analytics.js";

function fetchStub(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe("createResendContactStore", () => {
  const cfg = { apiKey: "re_test", audienceId: "aud_1" };

  it("POSTs contact to the audience and returns the id", async () => {
    const { calls, fetchFn } = fetchStub([{ status: 201, body: { id: "cont_123" } }]);
    const store = createResendContactStore({ ...cfg, fetchFn });
    const result = await store.createContact({ email: "ada@example.com", source: "hero" });
    expect(result).toEqual({ id: "cont_123", alreadyExisted: false });
    expect(calls[0].url).toBe("https://api.resend.com/audiences/aud_1/contacts");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer re_test" });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ email: "ada@example.com" });
  });

  it("on duplicate (409) falls back to GET by email", async () => {
    const { calls, fetchFn } = fetchStub([
      { status: 409, body: { name: "conflict" } },
      { status: 200, body: { id: "cont_dup" } },
    ]);
    const store = createResendContactStore({ ...cfg, fetchFn });
    const result = await store.createContact({ email: "ada@example.com", source: "hero" });
    expect(result).toEqual({ id: "cont_dup", alreadyExisted: true });
    expect(calls[1].url).toBe("https://api.resend.com/audiences/aud_1/contacts/ada%40example.com");
  });

  it("throws a friendly error on 401", async () => {
    const { fetchFn } = fetchStub([{ status: 401, body: { message: "invalid key" } }]);
    const store = createResendContactStore({ ...cfg, fetchFn });
    await expect(store.createContact({ email: "a@b.co", source: "x" })).rejects.toThrow(
      /Resend request failed \(401\)/,
    );
  });
});

describe("createPostHogAnalytics", () => {
  it("POSTs capture with api key, event, distinct_id and properties", async () => {
    const { calls, fetchFn } = fetchStub([{ status: 200, body: { status: 1 } }]);
    const analytics = createPostHogAnalytics({ apiKey: "phc_test", fetchFn });
    await analytics.capture({ name: "waitlist_signup", distinctId: "abc", properties: { source: "hero" } });
    expect(calls[0].url).toBe("https://eu.i.posthog.com/capture/");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "waitlist_signup",
      distinct_id: "abc",
      properties: { source: "hero" },
    });
  });

  it("throws on non-2xx so joinWaitlist can swallow and log", async () => {
    const { fetchFn } = fetchStub([{ status: 500, body: {} }]);
    const analytics = createPostHogAnalytics({ apiKey: "phc_test", fetchFn });
    await expect(analytics.capture({ name: "e", distinctId: "d" })).rejects.toThrow(
      /PostHog capture failed \(500\)/,
    );
  });
});
