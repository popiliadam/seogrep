import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget, turnstileEnabled, __resetTurnstileScriptForTest } from "./turnstile";

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
    cleanup();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    document.getElementById("cf-turnstile-script")?.remove();
    delete (globalThis as { turnstile?: unknown }).turnstile;
    __resetTurnstileScriptForTest();
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

  /**
   * The referee's scenario, reproduced. The first implementation resolved loadScript as soon as
   * the TAG existed, so a second mount while the script was still in flight found
   * window.turnstile undefined and returned silently: no widget, no alert, token null, submit
   * disabled forever. The fix is one shared promise that waits for the real load event.
   */
  it("a second mount before the script executes still renders once it does", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAA");
    const first = render(<TurnstileWidget onToken={() => {}} />);
    const script = document.getElementById("cf-turnstile-script") as HTMLScriptElement;
    first.unmount();

    // Second mount while the script is STILL in flight — window.turnstile does not exist yet.
    expect((globalThis as { turnstile?: unknown }).turnstile).toBeUndefined();
    const render2 = vi.fn(() => "widget-2");
    render(<TurnstileWidget onToken={() => {}} />);

    // FLUSHING HERE IS THE WHOLE TEST. Without it the pending .then() runs only after the lines
    // below, so a buggy loadScript that resolves early would still find window.turnstile present
    // and render — the defect would be masked by test ordering. Verified by mutation: restore
    // `if (getElementById(SCRIPT_ID)) return Promise.resolve()` and this case must go red.
    await act(async () => {
      await Promise.resolve();
    });

    // Only NOW does the script actually execute.
    (globalThis as { turnstile?: unknown }).turnstile = { render: render2, remove: vi.fn() };
    script.onload?.(new Event("load"));

    await waitFor(() => expect(render2).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // A script that loads but exposes no API (CSP block, ad blocker, Cloudflare outage) used to
  // return silently, leaving the button disabled with nothing on screen to explain why.
  it("reports a script that loads without exposing the API", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAA");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onToken = vi.fn();
    render(<TurnstileWidget onToken={onToken} />);
    const script = document.getElementById("cf-turnstile-script") as HTMLScriptElement;
    script.onload?.(new Event("load")); // loaded, but globalThis.turnstile left undefined
    expect(await screen.findByRole("alert")).toBeDefined();
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
