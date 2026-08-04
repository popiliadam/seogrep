"use client";

import { useCallback, useEffect, useState } from "react";
import { initializePaddle, type Environments, type Paddle } from "@paddle/paddle-js";
import { resolvePaddleEnvironment } from "../../../lib/paddle-env";
import { mintCheckoutAttribution } from "./attribution-action";

interface CheckoutButtonProps {
  /** Paddle price id for this package, or null when it is not configured. */
  readonly priceId: string | null;
  /** The signed-in user's id, from the server — passed to Paddle as customData. */
  readonly userId: string;
  readonly label?: string;
}

// NEXT_PUBLIC_* are inlined at build. Read once at module scope; a missing/invalid value keeps
// the button fail-closed rather than throwing. The environment goes through the shared resolver
// so the overlay and the server-side Node SDK can never disagree about sandbox vs production.
const CLIENT_TOKEN = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
const ENVIRONMENT: Environments | undefined = resolvePaddleEnvironment();

/**
 * Client checkout trigger. FAIL-CLOSED: with no priceId / client token / environment the button
 * is disabled and says checkout is not configured — today's state, since the Paddle keys are not
 * in yet, so the surface looks exactly as it did in T6. When configured it lazily initializes
 * Paddle.js and opens the overlay for the given price, passing the SERVER-provided user_id as
 * customData so the webhook can attribute the purchase (the id is never sourced from the client
 * for anything trust-bearing).
 *
 * M-05: customData is editable from this page while the overlay is open, so the id alone proves
 * nothing. A server action mints a signed attribution token at click time and it rides along under
 * `attribution_token` — the literal key here has to match ATTRIBUTION_CUSTOM_DATA_KEY in
 * lib/billing/attribution, which is a server-only module and so cannot be imported into this
 * client component; checkout-button.test.tsx asserts the two agree.
 */
export function CheckoutButton({ priceId, userId, label = "Buy" }: CheckoutButtonProps) {
  const configured = Boolean(priceId && CLIENT_TOKEN && ENVIRONMENT);
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the init effect — the "Try again" control, not just a re-render (L-08).
  const [initAttempt, setInitAttempt] = useState(0);
  const [initFailed, setInitFailed] = useState(false);

  useEffect(() => {
    if (!configured || !CLIENT_TOKEN || !ENVIRONMENT) {
      return;
    }
    let active = true;
    setInitFailed(false);
    initializePaddle({ token: CLIENT_TOKEN, environment: ENVIRONMENT })
      .then((instance) => {
        if (!active) {
          return;
        }
        if (instance) {
          setPaddle(instance);
          return;
        }
        // Resolved WITHOUT an instance: Paddle.js is unusable, same user-visible outcome as a
        // rejection. Previously this fell through silently and left the button disabled forever.
        console.error("paddle init returned no instance");
        setInitFailed(true);
      })
      .catch((caught) => {
        console.error("paddle init failed:", caught);
        if (active) {
          setInitFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [configured, initAttempt]);

  const openCheckout = useCallback(async () => {
    if (!paddle || !priceId) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      // M-05: customData is settable from this page, so user_id alone cannot be tenant authority.
      // The server action re-derives the id from the validated session and signs it; the webhook
      // trusts the SIGNED subject. A mint that fails or returns nothing must NEVER cost a sale —
      // checkout still opens, and the webhook's grace path accepts (and reports) the absence.
      let attributionToken: string | null = null;
      try {
        attributionToken = await mintCheckoutAttribution();
      } catch (caught) {
        console.error("paddle attribution mint failed; opening checkout unsigned:", caught);
      }
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customData: attributionToken
          ? { user_id: userId, attribution_token: attributionToken }
          : { user_id: userId },
      });
    } catch (caught) {
      console.error("paddle checkout open failed:", caught);
      setError("Could not open checkout. Please try again.");
    } finally {
      setPending(false);
    }
  }, [paddle, priceId, userId]);

  const retryInit = useCallback(() => {
    setPaddle(null);
    setError(null);
    setInitAttempt((attempt) => attempt + 1);
  }, []);

  // L-08: an init failure used to reach console.error ONLY, so the user faced a permanently
  // disabled "Buy" button with no explanation and nothing to click. Say what happened and offer
  // a real retry — the reason stays out of the UI (it is a Paddle/network internal), the log has it.
  if (initFailed) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled
          className="rounded-md bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-500"
        >
          {label}
        </button>
        <span role="alert" className="text-xs text-red-600">
          Checkout could not load.
        </span>
        <button
          type="button"
          onClick={retryInit}
          className="self-start text-xs font-medium text-neutral-700 underline hover:text-neutral-900"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled
          className="rounded-md bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-500"
        >
          {label}
        </button>
        <span className="text-xs text-neutral-400">Checkout not configured</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending || !paddle}
        onClick={() => {
          void openCheckout();
        }}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {label}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}
