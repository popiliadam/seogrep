/** 1 kredinin taban USD karşılığı (spec §3). Fiyat değişikliği = insan onayı. */
export const CREDIT_BASE_USD = 0.01;

export * from "./waitlist/waitlist.js";
export * from "./waitlist/memory.js";
export * from "./waitlist/resend-store.js";
export * from "./waitlist/posthog-analytics.js";

export * from "./billing/packages.js";
export * from "./billing/ledger.js";
export * from "./billing/paddle-events.js";

export * from "./email/send.js";
export * from "./email/welcome.js";

export * from "./keys/api-key.js";

// GSC at-rest token crypto + the bare-fetch Google Search Console client. Promoted here
// from apps/mcp so the web OAuth routes consume one BUILT implementation (no @pseo/mcp
// source deep-import / transpile) and the MCP `pull_gsc_data` read path shares the exact
// same seal format + client.
export * from "./gsc/crypto.js";
export * from "./gsc/client.js";
