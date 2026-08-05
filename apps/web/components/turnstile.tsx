"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile, wired so it is INERT until an operator provisions it.
 *
 * WHY THIS EXISTS. Signup is open self-serve and every verified account is granted 200 credits.
 * The H-06 mailbox fingerprint caps a real inbox at a handful of trials, but it cannot see a
 * catch-all domain: whoever owns one can mint addresses without limit. A challenge in front of
 * signup is the control that does not depend on the address at all.
 *
 * WHY NO npm DEPENDENCY. @marsidev/react-turnstile and @hcaptcha/react-hcaptcha are thin wrappers
 * over a script tag and a render call. Adding a runtime dependency to the auth path — the one
 * surface where a broken import means nobody can log in — was not worth saving these ~40 lines,
 * and contract.md makes every new dependency a licence + review gate.
 *
 * NO CSP CHANGE IS NEEDED, and that was checked rather than assumed: the global policy is
 * `frame-ancestors 'none'` only (lib/security-headers.ts), with no script-src or frame-src to
 * violate. The strict `default-src 'none'` policy applies to /r/:slug* alone, which has no form.
 *
 * THE DORMANT CONTRACT. With NEXT_PUBLIC_TURNSTILE_SITE_KEY unset this renders null, loads no
 * script, and reports a null token — so the forms behave exactly as they did before it existed.
 * Turning it on is: set the env var, then enable CAPTCHA in the Supabase dashboard with the
 * matching secret. Doing only ONE of those two breaks auth, which is why both live in the
 * enable procedure in docs/runbooks, not in this file's control.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "cf-turnstile-script";

interface TurnstileApi {
  render(element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; "expired-callback"?: () => void }): string;
  remove(widgetId: string): void;
}

declare global {
  var turnstile: TurnstileApi | undefined;
}

/** True when an operator has provisioned a site key. Forms use it to decide whether to gate submit. */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

function loadScript(): Promise<void> {
  if (document.getElementById(SCRIPT_ID)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile script failed to load"));
    document.head.appendChild(script);
  });
}

/**
 * `resetKey` is how a caller asks for a fresh challenge. Turnstile tokens are SINGLE USE, so a
 * form that failed after spending one (wrong password, weak password) must get a new widget
 * before the next attempt — otherwise the second submit fails on a stale token and the user is
 * stuck on an error they cannot act on. Callers bump the number after every submit.
 */
export function TurnstileWidget({
  onToken,
  resetKey = 0,
}: {
  onToken: (token: string | null) => void;
  resetKey?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) return;
    const container = containerRef.current;
    if (!container) return;

    let widgetId: string | undefined;
    let cancelled = false;

    onToken(null); // a re-render means the previous token is void
    setFailed(false);

    loadScript()
      .then(() => {
        if (cancelled || !globalThis.turnstile) return;
        container.replaceChildren(); // drop any previous widget DOM before re-rendering
        widgetId = globalThis.turnstile.render(container, {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
          "error-callback": () => {
            setFailed(true);
            onToken(null);
          },
          "expired-callback": () => onToken(null),
        });
      })
      .catch((error) => {
        console.error("turnstile:", error);
        setFailed(true);
        onToken(null);
      });

    return () => {
      cancelled = true;
      if (widgetId && globalThis.turnstile) globalThis.turnstile.remove(widgetId);
    };
    // onToken is expected to be stable (useCallback in the caller); resetKey drives re-arming.
  }, [siteKey, resetKey, onToken]);

  if (!siteKey) return null;

  return (
    <div className="flex flex-col gap-2">
      <div ref={containerRef} />
      {failed ? (
        <p role="alert" className="text-sm text-red-600">
          The verification challenge could not load. Please refresh and try again.
        </p>
      ) : null}
    </div>
  );
}
