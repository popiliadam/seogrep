/**
 * PostHog capture adapter.
 *
 * This used to live under `src/waitlist/` because the waitlist was its first caller. It was NOT
 * waitlist machinery: `apps/web/lib/analytics.ts` builds on it for the three product events that
 * outlived the waitlist — signup_completed (auth callback), mcp_key_created (connection actions)
 * and purchase_completed (Paddle webhook). Removing the waitlist moved it here rather than
 * deleting it with the folder, which would have broken the money path's analytics.
 */

export interface AnalyticsClient {
  capture(event: {
    name: string;
    distinctId: string;
    /** String or boolean values only — callers must never put PII / raw amounts here. */
    properties?: Record<string, string | boolean>;
  }): Promise<void>;
}

/** Hard cap per request so a hung PostHog call can never stall a caller (mirrors email/send.ts). */
const DEFAULT_TIMEOUT_MS = 3000;

interface PostHogConfig {
  apiKey: string;
  host?: string;
  fetchFn?: typeof fetch;
  /** Abort the request after this many ms (default 3000). Abort rejects -> callers' existing catch paths handle it. */
  timeoutMs?: number;
}

export function createPostHogAnalytics(config: PostHogConfig): AnalyticsClient {
  const fetchFn = config.fetchFn ?? fetch;
  const host = (config.host ?? "https://eu.i.posthog.com").replace(/\/$/, "");
  return {
    async capture(event) {
      const response = await fetchFn(`${host}/capture/`, {
        method: "POST",
        signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: config.apiKey,
          event: event.name,
          distinct_id: event.distinctId,
          properties: event.properties ?? {},
          timestamp: new Date().toISOString(),
        }),
      });
      if (!response.ok) throw new Error(`PostHog capture failed (${response.status})`);
    },
  };
}
