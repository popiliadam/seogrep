import type { ContactStore, WaitlistSignup } from "./waitlist.js";

interface ResendConfig {
  apiKey: string;
  segmentId: string;
  fetchFn?: typeof fetch;
  /** Abort each request after this many ms (default 3000). The deadline is always armed. */
  timeoutMs?: number;
}

const BASE_URL = "https://api.resend.com";
/**
 * Hard cap per request so a hung Resend call can never stall the waitlist request awaiting
 * it — bare `fetch` has no default timeout. 3000ms mirrors the sibling Resend adapter
 * (email/send.ts) and the PostHog adapter: same provider, same call class (one small
 * contact-API call on an interactive request path), so it gets the same budget.
 */
const DEFAULT_TIMEOUT_MS = 3000;

export function createResendContactStore(config: ResendConfig): ContactStore {
  const fetchFn = config.fetchFn ?? fetch;
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  /** A FRESH deadline per request: both calls below are separate network round trips. */
  const deadline = (): AbortSignal => AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  async function getExisting(email: string): Promise<{ id: string }> {
    const response = await fetchFn(`${BASE_URL}/contacts/${encodeURIComponent(email)}`, {
      signal: deadline(),
      headers,
    });
    if (!response.ok) throw new Error(`Resend request failed (${response.status})`);
    const data = (await response.json()) as { id: string };
    return { id: data.id };
  }

  return {
    async createContact(input: WaitlistSignup) {
      const response = await fetchFn(`${BASE_URL}/contacts`, {
        method: "POST",
        signal: deadline(),
        headers,
        body: JSON.stringify({
          email: input.email,
          unsubscribed: false,
          segments: [{ id: config.segmentId }],
        }),
      });
      if (response.status === 409) {
        const existing = await getExisting(input.email);
        return { id: existing.id, alreadyExisted: true };
      }
      if (!response.ok) throw new Error(`Resend request failed (${response.status})`);
      const data = (await response.json()) as { id: string };
      return { id: data.id, alreadyExisted: false };
    },
  };
}
