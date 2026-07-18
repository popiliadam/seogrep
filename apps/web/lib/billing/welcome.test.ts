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

/**
 * Minimal chainable stand-in for the service client used by sendWelcomeIfFirst.
 * Exposes the upsert/update spies so tests can pin call counts (at-most-once).
 */
function mockClient(
  updateResult: UpdateResult,
  upsertResult: { error: { message: string } | null } = { error: null },
) {
  const builder = {
    eq: () => builder,
    is: () => builder,
    select: () => Promise.resolve(updateResult),
  };
  const upsert = vi.fn(() => Promise.resolve(upsertResult));
  const update = vi.fn(() => builder);
  const client = { from: () => ({ upsert, update }) } as unknown as ReturnType<
    typeof createServiceClient
  >;
  return { client, upsert, update };
}

describe("sendWelcomeIfFirst", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "hello@seogrep.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.test");
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks(); // console.error spies must not leak into other tests
    vi.unstubAllEnvs();
  });

  it("sends exactly once when the lock flips NULL -> now, with composed connection + docs URLs", async () => {
    createServiceClientMock.mockReturnValue(
      mockClient({ data: [{ id: "u1" }], error: null }).client,
    );
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
    createServiceClientMock.mockReturnValue(mockClient({ data: [], error: null }).client);
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

  it("skips WITHOUT touching the lock when RESEND_API_KEY is missing (fail-open)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendWelcomeIfFirst("u1", "user@example.com");
    expect(createServiceClientMock).not.toHaveBeenCalled(); // one-time lock never consumed
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("throws when the profile upsert fails, before any lock attempt or send", async () => {
    const { client, update } = mockClient(
      { data: [{ id: "u1" }], error: null },
      { error: { message: "db down" } },
    );
    createServiceClientMock.mockReturnValue(client);
    await expect(sendWelcomeIfFirst("u1", "user@example.com")).rejects.toThrow(
      /welcome profile upsert failed: db down/,
    );
    expect(update).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("throws when the lock update fails, without sending", async () => {
    const { client } = mockClient({ data: null, error: { message: "conn reset" } });
    createServiceClientMock.mockReturnValue(client);
    await expect(sendWelcomeIfFirst("u1", "user@example.com")).rejects.toThrow(
      /welcome lock failed: conn reset/,
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("propagates a send failure so the lock stays set and the caller can log (no retry)", async () => {
    const { client, update } = mockClient({ data: [{ id: "u1" }], error: null });
    createServiceClientMock.mockReturnValue(client);
    sendEmailMock.mockRejectedValueOnce(new Error("Resend email failed (500)"));
    await expect(sendWelcomeIfFirst("u1", "user@example.com")).rejects.toThrow(
      /Resend email failed/,
    );
    // Behavioral pin of at-most-once: the lock UPDATE ran exactly once and is neither
    // rolled back nor retried after the send failure.
    expect(update).toHaveBeenCalledTimes(1);
  });
});
