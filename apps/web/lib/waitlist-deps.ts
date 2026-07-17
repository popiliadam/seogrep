import {
  createCapturingAnalytics,
  createMemoryContactStore,
  createPostHogAnalytics,
  createResendContactStore,
  type WaitlistDeps,
} from "@pseo/core";

let testOverride: WaitlistDeps | null = null;
let devFallback: WaitlistDeps | null = null;

export function setWaitlistDepsForTest(deps: WaitlistDeps): void {
  testOverride = deps;
}

export function resetWaitlistDepsForTest(): void {
  testOverride = null;
}

export function getWaitlistDeps(): WaitlistDeps | null {
  if (testOverride) return testOverride;
  const { RESEND_API_KEY, RESEND_SEGMENT_ID, POSTHOG_API_KEY, POSTHOG_HOST } = process.env;
  if (RESEND_API_KEY && RESEND_SEGMENT_ID && POSTHOG_API_KEY) {
    return {
      store: createResendContactStore({ apiKey: RESEND_API_KEY, segmentId: RESEND_SEGMENT_ID }),
      analytics: createPostHogAnalytics({ apiKey: POSTHOG_API_KEY, host: POSTHOG_HOST }),
    };
  }
  if (process.env.NODE_ENV !== "production") {
    devFallback ??= { store: createMemoryContactStore(), analytics: createCapturingAnalytics() };
    return devFallback;
  }
  return null;
}
