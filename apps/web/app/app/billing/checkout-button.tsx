"use client";

import { useCallback, useEffect, useState } from "react";
import { initializePaddle, type Environments, type Paddle } from "@paddle/paddle-js";

interface CheckoutButtonProps {
  /** Paddle price id for this package, or null when it is not configured. */
  readonly priceId: string | null;
  /** The signed-in user's id, from the server — passed to Paddle as customData. */
  readonly userId: string;
  readonly label?: string;
}

// NEXT_PUBLIC_* are inlined at build. Read once at module scope; a missing/invalid value keeps
// the button fail-closed rather than throwing.
const CLIENT_TOKEN = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
const RAW_ENV = process.env.NEXT_PUBLIC_PADDLE_ENV;
const ENVIRONMENT: Environments | undefined =
  RAW_ENV === "sandbox" || RAW_ENV === "production" ? RAW_ENV : undefined;

/**
 * Client checkout trigger. FAIL-CLOSED: with no priceId / client token / environment the button
 * is disabled and says checkout is not configured — today's state, since the Paddle keys are not
 * in yet, so the surface looks exactly as it did in T6. When configured it lazily initializes
 * Paddle.js and opens the overlay for the given price, passing the SERVER-provided user_id as
 * customData so the webhook can attribute the purchase (the id is never sourced from the client
 * for anything trust-bearing).
 */
export function CheckoutButton({ priceId, userId, label = "Buy" }: CheckoutButtonProps) {
  const configured = Boolean(priceId && CLIENT_TOKEN && ENVIRONMENT);
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured || !CLIENT_TOKEN || !ENVIRONMENT) {
      return;
    }
    let active = true;
    initializePaddle({ token: CLIENT_TOKEN, environment: ENVIRONMENT })
      .then((instance) => {
        if (active && instance) {
          setPaddle(instance);
        }
      })
      .catch((caught) => {
        console.error("paddle init failed:", caught);
      });
    return () => {
      active = false;
    };
  }, [configured]);

  const openCheckout = useCallback(() => {
    if (!paddle || !priceId) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customData: { user_id: userId },
      });
    } catch (caught) {
      console.error("paddle checkout open failed:", caught);
      setError("Could not open checkout. Please try again.");
    } finally {
      setPending(false);
    }
  }, [paddle, priceId, userId]);

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
        onClick={openCheckout}
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
