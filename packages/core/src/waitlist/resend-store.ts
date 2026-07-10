import type { ContactStore, WaitlistSignup } from "./waitlist.js";

interface ResendConfig {
  apiKey: string;
  audienceId: string;
  fetchFn?: typeof fetch;
}

const BASE_URL = "https://api.resend.com";

export function createResendContactStore(config: ResendConfig): ContactStore {
  const fetchFn = config.fetchFn ?? fetch;
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  async function getExisting(email: string): Promise<{ id: string }> {
    const response = await fetchFn(
      `${BASE_URL}/audiences/${config.audienceId}/contacts/${encodeURIComponent(email)}`,
      { headers },
    );
    if (!response.ok) throw new Error(`Resend request failed (${response.status})`);
    const data = (await response.json()) as { id: string };
    return { id: data.id };
  }

  return {
    async createContact(input: WaitlistSignup) {
      const response = await fetchFn(`${BASE_URL}/audiences/${config.audienceId}/contacts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: input.email, unsubscribed: false }),
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
