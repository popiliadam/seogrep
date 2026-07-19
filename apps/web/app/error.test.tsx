import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppError from "./error";

/**
 * The app-wide error boundary must reassure without leaking: an on-brand English message +
 * a working retry, and NONE of the raw error detail (message / digest / stack) in the DOM.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SECRET = "postgres://user:pa55w0rd@db.internal:5432 — stack frame leak";

describe("app error boundary", () => {
  it("renders a calm, on-brand message and a retry without leaking error detail", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error(SECRET), { digest: "digest-abc123" });
    render(<AppError error={error} reset={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Something went wrong");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();

    // No internal detail reaches the DOM.
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).not.toContain("digest-abc123");
  });

  it("calls reset() when the visitor clicks Try again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn();
    render(<AppError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
