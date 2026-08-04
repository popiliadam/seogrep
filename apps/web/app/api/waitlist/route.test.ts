import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { resetWaitlistDepsForTest, setWaitlistDepsForTest } from "../../../lib/waitlist-deps";
import { createCapturingAnalytics, createMemoryContactStore } from "@pseo/core";

/**
 * The route throttles per client IP and holds those buckets in module memory for the
 * lifetime of the process, so tests that care about the budget pass their OWN address and
 * never share one. Tests that do not care keep the default.
 */
function jsonRequest(body: unknown, clientIp = "203.0.113.1"): Request {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nf-client-connection-ip": clientIp,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/waitlist", () => {
  let store: ReturnType<typeof createMemoryContactStore>;
  let analytics: ReturnType<typeof createCapturingAnalytics>;

  beforeEach(() => {
    store = createMemoryContactStore();
    analytics = createCapturingAnalytics();
    setWaitlistDepsForTest({ store, analytics });
    return () => resetWaitlistDepsForTest();
  });

  it("records a valid signup and answers a fixed, information-free envelope", async () => {
    const response = await POST(jsonRequest({ email: "ada@example.com", source: "hero" }));
    expect(response.status).toBe(200);
    // Exact shape, not toMatchObject: the point of L-05 is that NOTHING else rides along.
    // The signup itself is still proven by the store, where it belongs.
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(store.contacts).toHaveLength(1);
    expect(store.contacts[0]).toMatchObject({ id: "wl_1", email: "ada@example.com", source: "hero" });
  });

  it("returns 400 for an invalid email", async () => {
    const response = await POST(jsonRequest({ email: "nope" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("silently accepts honeypot submissions without side effects", async () => {
    const response = await POST(jsonRequest({ email: "bot@spam.com", website: "https://spam" }));
    expect(response.status).toBe(200);
    expect(store.contacts).toHaveLength(0);
  });

  it("returns 400 when the JSON body is literally null", async () => {
    const response = await POST(jsonRequest(null));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("answers a repeat address exactly as it answers a new one (L-05)", async () => {
    const ip = "198.51.100.20";
    const first = await POST(jsonRequest({ email: "repeat@example.com" }, ip));
    const second = await POST(jsonRequest({ email: "repeat@example.com" }, ip));

    expect([first.status, second.status]).toEqual([200, 200]);
    // The store DID see the address twice and knows it already existed…
    expect(store.contacts).toHaveLength(1);
    // …but an anonymous caller cannot tell the two responses apart, so the endpoint is no
    // longer a membership oracle, and no Resend contact id ever reaches the wire.
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
    expect(firstBody).toEqual({ ok: true });
    expect(secondBody).toEqual(firstBody);
  });

  it("answers a honeypot submission exactly as it answers a real one (L-05)", async () => {
    const real = await POST(jsonRequest({ email: "real@example.com" }, "198.51.100.21"));
    const trapped = await POST(
      jsonRequest({ email: "bot@spam.com", website: "https://spam" }, "198.51.100.22"),
    );
    expect(trapped.status).toBe(real.status);
    await expect(trapped.json()).resolves.toEqual(await real.json());
  });

  it("caps how many provider calls one flooding IP can spend (M-23)", async () => {
    const burst = 40;
    const responses: Response[] = [];
    for (let index = 0; index < burst; index += 1) {
      responses.push(await POST(jsonRequest({ email: `flood${index}@example.com` }, "198.51.100.7")));
    }

    const refused = responses.filter((response) => response.status === 429);
    expect(refused.length).toBeGreaterThan(0);
    // Every accepted request creates exactly one contact (the emails are distinct), so an
    // accepted-count below `burst` IS the reduction in paid Resend round-trips.
    expect(store.contacts.length).toBeLessThan(burst);
    expect(store.contacts).toHaveLength(burst - refused.length);
    // Analytics is charged in lockstep — a refused request pollutes no PostHog funnel.
    expect(analytics.captured).toHaveLength(store.contacts.length);
  });

  it("spends ZERO provider calls on a request it refuses (M-23)", async () => {
    const ip = "198.51.100.8";
    let refusal: Response | null = null;
    for (let index = 0; index < 40 && refusal === null; index += 1) {
      const response = await POST(jsonRequest({ email: `burn${index}@example.com` }, ip));
      if (response.status === 429) refusal = response;
    }
    expect(refusal).not.toBeNull();

    const storeCallsBefore = store.contacts.length;
    const analyticsCallsBefore = analytics.captured.length;
    const response = await POST(jsonRequest({ email: "after-limit@example.com" }, ip));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ ok: false });
    expect(store.contacts).toHaveLength(storeCallsBefore);
    expect(analytics.captured).toHaveLength(analyticsCallsBefore);
  });

  it("keeps a fresh budget per client IP (M-23)", async () => {
    for (let index = 0; index < 40; index += 1) {
      await POST(jsonRequest({ email: `noisy${index}@example.com` }, "198.51.100.9"));
    }
    const neighbour = await POST(jsonRequest({ email: "quiet@example.com" }, "198.51.100.10"));
    expect(neighbour.status).toBe(200);
  });

  it("never spends the budget on a honeypot submission (M-23)", async () => {
    const ip = "198.51.100.11";
    for (let index = 0; index < 40; index += 1) {
      await POST(jsonRequest({ email: `bot${index}@spam.com`, website: "https://spam" }, ip));
    }
    const human = await POST(jsonRequest({ email: "human@example.com" }, ip));
    expect(human.status).toBe(200);
    expect(store.contacts).toHaveLength(1);
  });
});
