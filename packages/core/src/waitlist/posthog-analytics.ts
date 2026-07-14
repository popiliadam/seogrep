import type { AnalyticsClient } from "./waitlist.js";

interface PostHogConfig {
  apiKey: string;
  host?: string;
  fetchFn?: typeof fetch;
}

export function createPostHogAnalytics(config: PostHogConfig): AnalyticsClient {
  const fetchFn = config.fetchFn ?? fetch;
  const host = (config.host ?? "https://eu.i.posthog.com").replace(/\/$/, "");
  return {
    async capture(event) {
      const response = await fetchFn(`${host}/capture/`, {
        method: "POST",
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
