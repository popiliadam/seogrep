import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// LoginPage's own concern is the ?error=auth banner; AuthForm's submit behavior has its
// own dedicated test file (../auth-form.test.tsx). Stub it here so this file doesn't need
// to also wire next/navigation + the Supabase browser client just to mount it.
vi.mock("../auth-form", () => ({
  AuthForm: () => <div data-testid="auth-form" />,
}));

import LoginPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

async function renderLogin(error: string | undefined) {
  const searchParams = Promise.resolve(error === undefined ? {} : { error });
  render(await LoginPage({ searchParams }));
}

describe("LoginPage", () => {
  it("error=auth renders the expired/invalid-link banner above the form, as role=alert", async () => {
    await renderLogin("auth");

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toMatch(/confirmation link is invalid or has expired/i);

    // "above the form": banner must precede the AuthForm in document order.
    const form = screen.getByTestId("auth-form");
    expect(banner.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no error param renders no banner", async () => {
    await renderLogin(undefined);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an unrecognized error value renders no banner (allowlist, not a truthy check)", async () => {
    await renderLogin("bogus");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
