import type { AnalyticsClient, ContactStore, WaitlistSignup } from "./waitlist.js";

interface MemoryContact {
  id: string;
  email: string;
  source: string;
}

export interface MemoryContactStore extends ContactStore {
  contacts: readonly MemoryContact[];
}

export function createMemoryContactStore(): MemoryContactStore {
  let contacts: readonly MemoryContact[] = [];
  return {
    get contacts() {
      return contacts;
    },
    async createContact(input: WaitlistSignup) {
      const existing = contacts.find((c) => c.email === input.email);
      if (existing) return { id: existing.id, alreadyExisted: true };
      const contact = { id: `wl_${contacts.length + 1}`, email: input.email, source: input.source };
      contacts = [...contacts, contact];
      return { id: contact.id, alreadyExisted: false };
    },
  };
}

interface CapturedEvent {
  name: string;
  distinctId: string;
  properties?: Record<string, string | boolean>;
}

export interface CapturingAnalytics extends AnalyticsClient {
  captured: readonly CapturedEvent[];
}

export function createCapturingAnalytics(): CapturingAnalytics {
  let captured: readonly CapturedEvent[] = [];
  return {
    get captured() {
      return captured;
    },
    async capture(event: CapturedEvent) {
      captured = [...captured, event];
    },
  };
}
