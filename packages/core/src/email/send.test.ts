import { describe, expect, it } from "vitest";
import { sendEmail } from "./send.js";

/** Records outbound calls and replays a scripted queue of responses. No real network. */
function fetchStub(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const message = {
  apiKey: "re_test",
  from: "hello@seogrep.com",
  to: "ada@example.com",
  subject: "Welcome to SeoGrep",
  html: "<h1>Welcome</h1>",
};

describe("sendEmail", () => {
  it("POSTs to /emails with the bearer key + from/to/subject/html and returns the id", async () => {
    const { calls, fetchFn } = fetchStub([{ status: 200, body: { id: "email_123" } }]);
    const result = await sendEmail({ ...message, fetchFn });
    expect(result).toEqual({ id: "email_123" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer re_test",
      "Content-Type": "application/json",
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal); // hang protection is always armed
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: "hello@seogrep.com",
      to: "ada@example.com",
      subject: "Welcome to SeoGrep",
      html: "<h1>Welcome</h1>",
    });
  });

  it("returns { id: undefined } when a 2xx body has no usable id (honest typing, no throw)", async () => {
    const { fetchFn } = fetchStub([{ status: 200, body: {} }]);
    await expect(sendEmail({ ...message, fetchFn })).resolves.toEqual({ id: undefined });
  });

  it("throws a friendly error on a 4xx including a truncated response-body snippet", async () => {
    const { fetchFn } = fetchStub([{ status: 422, body: { message: "invalid from" } }]);
    await expect(sendEmail({ ...message, fetchFn })).rejects.toThrow(
      /Resend email failed \(422\): .*invalid from/,
    );
  });

  it("aborts a hung request after timeoutMs and throws (auth redirect can never hang)", async () => {
    const fetchFn = ((_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    await expect(sendEmail({ ...message, fetchFn, timeoutMs: 10 })).rejects.toThrow(
      /timeout|aborted/i,
    );
  });

  it("propagates a network error (fetch rejects)", async () => {
    const fetchFn = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(sendEmail({ ...message, fetchFn })).rejects.toThrow(/network down/);
  });
});
