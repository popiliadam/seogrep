import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wrapper unit tests — the ADAPTER is mocked (createPostHogAnalytics), not fetch: the
 * HTTP-transport contract (endpoint, timeout, non-2xx throw) is already pinned by
 * packages/core's adapters.test.ts. These tests pin the wrapper's own job — mapping the
 * three funnel events onto AnalyticsClient.capture with the right name, a sha256 (never
 * raw) distinct_id, and an allow-listed property object that can NEVER carry email or a
 * raw amount (object-equality, not toMatchObject, so a stray leaked field would fail).
 */

const { captureMock, createPostHogAnalyticsMock } = vi.hoisted(() => {
  const captureMock = vi.fn().mockResolvedValue(undefined);
  const createPostHogAnalyticsMock = vi.fn(() => ({ capture: captureMock }));
  return { captureMock, createPostHogAnalyticsMock };
});

vi.mock("server-only", () => ({}));
vi.mock("@pseo/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pseo/core")>();
  return { ...actual, createPostHogAnalytics: createPostHogAnalyticsMock };
});

import { capturePurchase, captureKeyCreated, captureSignup } from "./analytics";

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("analytics wrapper", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe("with POSTHOG_API_KEY configured", () => {
    beforeEach(() => {
      vi.stubEnv("POSTHOG_API_KEY", "phc_test");
      vi.stubEnv("POSTHOG_HOST", "https://eu.i.posthog.com");
    });

    it("captureSignup fires signup_completed with a sha256 distinct_id and no properties", async () => {
      await captureSignup("user-1");
      expect(captureMock).toHaveBeenCalledWith({
        name: "signup_completed",
        distinctId: sha256("user-1"),
        properties: {},
      });
    });

    it("captureKeyCreated(false) fires mcp_key_created with rotated:false only", async () => {
      await captureKeyCreated("user-1", false);
      expect(captureMock).toHaveBeenCalledWith({
        name: "mcp_key_created",
        distinctId: sha256("user-1"),
        properties: { rotated: false },
      });
    });

    it("captureKeyCreated(true) fires mcp_key_created with rotated:true", async () => {
      await captureKeyCreated("user-1", true);
      expect(captureMock).toHaveBeenCalledWith({
        name: "mcp_key_created",
        distinctId: sha256("user-1"),
        properties: { rotated: true },
      });
    });

    it("capturePurchase fires purchase_completed with the package name only (never an amount)", async () => {
      await capturePurchase("user-1", "starter");
      expect(captureMock).toHaveBeenCalledWith({
        name: "purchase_completed",
        distinctId: sha256("user-1"),
        properties: { package: "starter" },
      });
    });

    it("never puts the raw user id or an email string anywhere in the captured event", async () => {
      await captureSignup("user@example.com");
      await captureKeyCreated("user@example.com", true);
      await capturePurchase("user@example.com", "pro");
      expect(captureMock).toHaveBeenCalledTimes(3);
      for (const [event] of captureMock.mock.calls) {
        expect(JSON.stringify(event)).not.toContain("user@example.com");
        expect(event.distinctId).toBe(sha256("user@example.com"));
      }
    });

    it("builds the adapter from POSTHOG_API_KEY / POSTHOG_HOST env", async () => {
      await captureSignup("user-1");
      expect(createPostHogAnalyticsMock).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "phc_test", host: "https://eu.i.posthog.com" }),
      );
    });

    it("swallows a capture rejection (best-effort — never throws) and logs it", async () => {
      captureMock.mockRejectedValueOnce(new Error("posthog down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(captureSignup("user-1")).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  it("skips silently with no adapter construction when POSTHOG_API_KEY is unset", async () => {
    vi.stubEnv("POSTHOG_API_KEY", ""); // hermetic: a developer shell exporting the key must not flip this test
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(captureSignup("user-1")).resolves.toBeUndefined();
    await expect(captureKeyCreated("user-1", false)).resolves.toBeUndefined();
    await expect(capturePurchase("user-1", "starter")).resolves.toBeUndefined();
    expect(createPostHogAnalyticsMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled(); // silent skip, not even a log — dev without keys stays quiet
  });
});
