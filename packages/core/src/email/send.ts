/**
 * Resend transactional email adapter (Phase 1 fetch-adapter pattern). Pure-ish: the
 * API key is a PARAMETER — this module never reads env — and `fetchFn` is injectable
 * so tests exercise it against fixtures with ZERO real network calls (CLAUDE.md
 * NEVER #5). The one-time trigger + lock live in apps/web; the content in welcome.ts.
 */

const BASE_URL = "https://api.resend.com";

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailConfig extends EmailMessage {
  apiKey: string;
  fetchFn?: typeof fetch;
}

export async function sendEmail(config: SendEmailConfig): Promise<{ id: string }> {
  const fetchFn = config.fetchFn ?? fetch;
  const response = await fetchFn(`${BASE_URL}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: config.to,
      subject: config.subject,
      html: config.html,
    }),
  });
  if (!response.ok) throw new Error(`Resend email failed (${response.status})`);
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}
