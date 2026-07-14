import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitlistForm } from "./waitlist-form";

describe("WaitlistForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits the email and shows the success state", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, id: "wl_1", alreadyExisted: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitlistForm source="hero" />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ada@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /join the waitlist/i }));
    await waitFor(() => expect(screen.getByText(/you're on the list/i)).toBeDefined());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ email: "ada@example.com", source: "hero" });
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
