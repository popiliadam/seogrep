import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { resetWaitlistDepsForTest, setWaitlistDepsForTest } from "../../../lib/waitlist-deps";
import { createCapturingAnalytics, createMemoryContactStore } from "@pseo/core";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/waitlist", () => {
  let store: ReturnType<typeof createMemoryContactStore>;

  beforeEach(() => {
    store = createMemoryContactStore();
    setWaitlistDepsForTest({ store, analytics: createCapturingAnalytics() });
    return () => resetWaitlistDepsForTest();
  });

  it("returns 200 with the record id for a valid signup", async () => {
    const response = await POST(jsonRequest({ email: "ada@example.com", source: "hero" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, id: "wl_1" });
    expect(store.contacts).toHaveLength(1);
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
});
