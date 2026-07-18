import type { AnalyticsClient } from "./waitlist.js";

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
