import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@pseo/db/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@pseo/core", () => ({
  sendEmail: vi.fn(),
  welcomeEmail: vi.fn(() => ({ subject: "Welcome to SeoGrep", html: "<h1>hi</h1>" })),
}));

import { sendEmail, welcomeEmail } from "@pseo/core";
import { createServiceClient } from "@pseo/db/server";
import { sendWelcomeIfFirst } from "./welcome";

const sendEmailMock = vi.mocked(sendEmail);
const welcomeEmailMock = vi.mocked(welcomeEmail);
const createServiceClientMock = vi.mocked(createServiceClient);

interface UpdateResult {
  data: { id: string }[] | null;
  error: { message: string } | null;
}

/** Minimal chainable stand-in for the service client used by sendWelcomeIfFirst. */
function mockClient(updateResult: UpdateResult) {
  const builder = {
    eq: () => builder,
    is: () => builder,
    select: () => Promise.resolve(updateResult),
  };
  return {
    from: () => ({
      upsert: () => Promise.resolve({ error: null }),
      update: () => builder,
    }),
  } as unknown as ReturnType<typeof createServiceClient>;
}

describe("sendWelcomeIfFirst", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "hello@seogrep.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.test");
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends exactly once when the lock flips NULL -> now, with composed connection + docs URLs", async () => {
    createServiceClientMock.mockReturnValue(mockClient({ data: [{ id: "u1" }], error: null }));
    await sendWelcomeIfFirst("u1", "user@example.com");
    expect(welcomeEmailMock).toHaveBeenCalledWith({
      dashboardUrl: "https://app.test/app/connection",
      docsUrl: "https://app.test/docs",
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "re_test",
        from: "hello@seogrep.com",
        to: "user@example.com",
        subject: "Welcome to SeoGrep",
        html: "<h1>hi</h1>",
      }),
    );
  });

  it("does not send when welcomed_at is already set (no row returned)", async () => {
    createServiceClientMock.mockReturnValue(mockClient({ data: [], error: null }));
    await sendWelcomeIfFirst("u1", "user@example.com");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("skips WITHOUT touching the lock when RESEND_FROM_EMAIL is missing (fail-open)", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendWelcomeIfFirst("u1", "user@example.com");
    expect(createServiceClientMock).not.toHaveBeenCalled(); // one-time lock never consumed
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("propagates a send failure so the lock stays set and the caller can log (no retry)", async () => {
    createServiceClientMock.mockReturnValue(mockClient({ data: [{ id: "u1" }], error: null }));
    sendEmailMock.mockRejectedValueOnce(new Error("Resend email failed (500)"));
    await expect(sendWelcomeIfFirst("u1", "user@example.com")).rejects.toThrow(
      /Resend email failed/,
    );
  });
});
