import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget, turnstileEnabled } from "./turnstile";

/**
 * The dormant contract. Everything here is about the UNPROVISIONED state, because that is the
 * state this ships in: if these break, an operator who has not touched Cloudflare gets a broken
 * auth page — the exact failure the env gate exists to prevent.
 *
 * NEXT_PUBLIC_* is inlined at build time by Next, but vitest reads process.env at call time, so
 * stubEnv is a faithful stand-in for a build with the var set.
 */
describe("TurnstileWidget (unprovisioned)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("reports disabled with no site key", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(turnstileEnabled()).toBe(false);
  });

  it("renders nothing at all", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const { container } = render(<TurnstileWidget onToken={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("injects no third-party script", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    render(<TurnstileWidget onToken={() => {}} />);
    expect(document.getElementById("cf-turnstile-script")).toBeNull();
    expect(document.querySelector('script[src*="cloudflare"]')).toBeNull();
  });

  it("never reports a token", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const onToken = vi.fn();
    render(<TurnstileWidget onToken={onToken} />);
    expect(onToken).not.toHaveBeenCalled();
  });
});

describe("TurnstileWidget (provisioned)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    document.getElementById("cf-turnstile-script")?.remove();
    delete (globalThis as { turnstile?: unknown }).turnstile;
  });

  it("reports enabled once a site key exists", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAA");
    expect(turnstileEnabled()).toBe(true);
  });

  it("mounts a container and requests the Cloudflare script", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAA");
    render(<TurnstileWidget onToken={() => {}} />);
    const script = document.getElementById("cf-turnstile-script") as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script?.src).toContain("challenges.cloudflare.com");
  });

  // A challenge that cannot load must SAY so rather than leaving a dead box and a disabled
  // button with no explanation.
  it("surfaces a load failure to the user", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAA");
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<TurnstileWidget onToken={() => {}} />);
    const script = document.getElementById("cf-turnstile-script") as HTMLScriptElement;
    script.onerror?.(new Event("error"));
    expect(await screen.findByRole("alert")).toBeDefined();
  });
});
