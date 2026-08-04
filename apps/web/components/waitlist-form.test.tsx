import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitlistForm } from "./waitlist-form";

describe("WaitlistForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits the email and shows the success state", async () => {
    // The LIVE server contract since L-05: a fixed, information-free `{ ok: true }`. The
    // provider id and the `alreadyExisted` flag this mock used to carry were removed from the
    // response precisely because they were a membership oracle — mocking them here kept a
    // retired shape alive and let the client keep a branch the server can no longer reach.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitlistForm source="hero" />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));
    await waitFor(() => expect(screen.getByText(/you're on the list/i)).toBeDefined());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ email: "ada@example.com", source: "hero" });
  });

  // The client must not resurrect the oracle the endpoint gave up. /api/waitlist answers every
  // accepted signup identically on purpose (L-05), so differentiated copy driven by a body flag
  // is one server regression away from telling an anonymous visitor whether an address is
  // already on the list. One success message, whatever the body claims.
  it("shows the one success message even if a body carries the retired alreadyExisted flag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, alreadyExisted: true }), { status: 200 }),
    ));
    render(<WaitlistForm source="hero" />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));
    await waitFor(() => expect(screen.getByText(/you're on the list/i)).toBeDefined());
    expect(screen.queryByText(/already on the list/i)).toBeNull();
  });

  it("shows the server error message on 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "Please enter a valid email address." }), { status: 400 }),
    ));
    render(<WaitlistForm source="hero" />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "x@y.z" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));
    await waitFor(() => expect(screen.getByText(/valid email/i)).toBeDefined());
  });
});
