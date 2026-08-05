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
 * matching secret. Doing only ONE of those two breaks sign-in and password reset as well as
 * signup. The step-by-step procedure is in the repo-root `.env.example`, next to the variable
 * itself — there is no Turnstile runbook, and an earlier version of this comment pointed at a
 * `docs/runbooks` file that does not exist, which is the worst possible place to be wrong.
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

/**
 * Memoised at module scope, NOT keyed on "is the tag in the DOM".
 *
 * The first version resolved as soon as `getElementById(SCRIPT_ID)` returned something, which is
 * true the instant the tag is appended and long before it has executed. A referee found what that
 * costs: React StrictMode double-invokes effects in dev, so pass 1 appends the tag and pass 2
 * resolves immediately, finds `globalThis.turnstile` still undefined, and bails — no widget, no
 * error, token stuck at null, submit button disabled forever. Same shape in production on a fast
 * navigation between /login and /signup while the script is in flight.
 *
 * One shared promise means every caller awaits the SAME real load event. A rejection clears it so
 * a later mount can retry rather than inheriting a permanently poisoned promise.
 */
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const fail = () => {
      scriptPromise = null;
      reject(new Error("Turnstile script failed to load"));
    };
    // A tag with no memoised promise means a module re-evaluation (HMR) left it behind.
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (globalThis.turnstile) {
        resolve();
        return;
      }
      // Tag present, API absent, and no way to tell whether `load` already fired — attaching a
      // listener here can wait forever on an event that is in the past, which is the silent
      // never-settles version of the bug this function exists to fix. Discard it and start a
      // clean load instead; a duplicate request is cheap, a permanently disabled button is not.
      existing.remove();
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Test seam: the memoised promise is module state and would leak between cases. */
export function __resetTurnstileScriptForTest(): void {
  scriptPromise = null;
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
        if (cancelled) return;
        // The script resolved but exposed no API: a CSP block, an ad blocker, or a Cloudflare
        // outage. Silently returning here is what left the button disabled with no explanation.
        if (!globalThis.turnstile) {
          console.error("turnstile: script loaded but window.turnstile is undefined");
          setFailed(true);
          onToken(null);
          return;
        }
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
