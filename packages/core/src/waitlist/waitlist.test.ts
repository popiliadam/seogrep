import { describe, expect, it } from "vitest";
import { joinWaitlist, WaitlistValidationError } from "./waitlist.js";
import { createMemoryContactStore } from "./memory.js";
import { createCapturingAnalytics } from "./memory.js";

const deps = () => {
  const store = createMemoryContactStore();
  const analytics = createCapturingAnalytics();
  return { store, analytics };
};

describe("joinWaitlist", () => {
  it("creates a contact and captures waitlist_signup with hashed distinct id", async () => {
    const d = deps();
    const result = await joinWaitlist({ email: "Ada@Example.com", source: "hero" }, d);
    expect(result.ok).toBe(true);
    expect(result.id).toMatch(/^wl_/);
    expect(result.alreadyExisted).toBe(false);
    expect(d.store.contacts).toEqual([{ id: result.id, email: "ada@example.com", source: "hero" }]);
    const [event] = d.analytics.captured;
    expect(event.name).toBe("waitlist_signup");
    expect(event.distinctId).toMatch(/^[a-f0-9]{64}$/); // sha256(email)
    expect(event.properties).toEqual({ email_domain: "example.com", source: "hero" });
  });

  it("rejects invalid email with WaitlistValidationError", async () => {
    await expect(joinWaitlist({ email: "not-an-email" }, deps())).rejects.toBeInstanceOf(
      WaitlistValidationError,
    );
  });

  it("reports alreadyExisted on duplicate email without failing", async () => {
    const d = deps();
    const first = await joinWaitlist({ email: "ada@example.com" }, d);
    const second = await joinWaitlist({ email: "ada@example.com" }, d);
    expect(second).toEqual({ ok: true, id: first.id, alreadyExisted: true });
    expect(d.store.contacts).toHaveLength(1);
  });

  it("still succeeds when analytics capture throws", async () => {
    const d = deps();
    const failing = { capture: async () => { throw new Error("posthog down"); } };
    const result = await joinWaitlist({ email: "ada@example.com" }, { store: d.store, analytics: failing });
    expect(result.ok).toBe(true);
  });

  it("defaults source to 'landing'", async () => {
    const d = deps();
    await joinWaitlist({ email: "ada@example.com" }, d);
    expect(d.store.contacts[0].source).toBe("landing");
  });
});
