/**
 * Resend transactional email adapter (Phase 1 fetch-adapter pattern). Pure-ish: the
 * API key is a PARAMETER — this module never reads env — and `fetchFn` is injectable
 * so tests exercise it against fixtures with ZERO real network calls (CLAUDE.md
 * NEVER #5). The one-time trigger + lock live in apps/web; the content in welcome.ts.
 */

const BASE_URL = "https://api.resend.com";
/** Hard cap per request so a hung Resend call can never stall the auth redirect. */
const DEFAULT_TIMEOUT_MS = 3000;
/** Error-body excerpt length: enough to debug a smoke run, short enough for logs. */
const ERROR_SNIPPET_CHARS = 200;

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailConfig extends EmailMessage {
  apiKey: string;
  fetchFn?: typeof fetch;
  /** Abort the request after this many ms (default 3000). Abort rejects -> callers' existing catch paths handle it. */
  timeoutMs?: number;
}

export async function sendEmail(config: SendEmailConfig): Promise<{ id: string | undefined }> {
  const fetchFn = config.fetchFn ?? fetch;
  const response = await fetchFn(`${BASE_URL}/emails`, {
    method: "POST",
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
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
  if (!response.ok) {
    // The snippet is Resend's own error body (never our key or the recipient address),
    // truncated — exactly what a failed `pnpm email:smoke` run needs to debug.
    const snippet = (await response.text().catch(() => "")).slice(0, ERROR_SNIPPET_CHARS);
    throw new Error(`Resend email failed (${response.status})${snippet ? `: ${snippet}` : ""}`);
  }
  // Honest typing instead of a bare cast: a malformed 2xx body yields { id: undefined }
  // rather than a lie — the mail was accepted, we just could not read its id.
  const data = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return { id: typeof data?.id === "string" ? data.id : undefined };
}
