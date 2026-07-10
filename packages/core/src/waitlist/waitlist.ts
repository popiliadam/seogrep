import { createHash } from "node:crypto";
import { z } from "zod";

export const waitlistSignupSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  source: z.string().trim().min(1).max(100).default("landing"),
});

export type WaitlistSignup = z.infer<typeof waitlistSignupSchema>;

export interface ContactStore {
  createContact(input: WaitlistSignup): Promise<{ id: string; alreadyExisted: boolean }>;
}

export interface AnalyticsClient {
  capture(event: {
    name: string;
    distinctId: string;
    properties?: Record<string, string>;
  }): Promise<void>;
}

export interface WaitlistDeps {
  store: ContactStore;
  analytics: AnalyticsClient;
}

export interface WaitlistResult {
  ok: true;
  id: string;
  alreadyExisted: boolean;
}

export class WaitlistValidationError extends Error {}

export async function joinWaitlist(raw: unknown, deps: WaitlistDeps): Promise<WaitlistResult> {
  const parsed = waitlistSignupSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WaitlistValidationError("Please enter a valid email address.");
  }
  const signup = parsed.data;
  const { id, alreadyExisted } = await deps.store.createContact(signup);
  try {
    await deps.analytics.capture({
      name: "waitlist_signup",
      distinctId: createHash("sha256").update(signup.email).digest("hex"),
      properties: { email_domain: signup.email.split("@")[1] ?? "", source: signup.source },
    });
  } catch (error) {
    console.error("waitlist analytics capture failed:", error);
  }
  return { ok: true, id, alreadyExisted };
}
