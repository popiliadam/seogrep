/**
 * ONE resolver for the Paddle environment, shared by the browser checkout overlay
 * (@paddle/paddle-js) and the server-side Node SDK (@paddle/paddle-node-sdk). Both sides read
 * the SAME NEXT_PUBLIC_PADDLE_ENV, so a sandbox rehearsal cannot end up with the overlay on
 * sandbox and the server verifying/calling production.
 *
 * Deliberately strict: exact literals only, no trimming and no case folding. An unrecognised
 * value resolves to undefined, which keeps the checkout button fail-closed and leaves the
 * server SDK on its own default rather than guessing an API base from a typo.
 */
export function resolvePaddleEnvironment(): "sandbox" | "production" | undefined {
  const raw = process.env.NEXT_PUBLIC_PADDLE_ENV;
  return raw === "sandbox" || raw === "production" ? raw : undefined;
}
