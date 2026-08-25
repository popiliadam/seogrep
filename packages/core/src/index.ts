/** 1 kredinin taban USD karşılığı (spec §3). Fiyat değişikliği = insan onayı. */
export const CREDIT_BASE_USD = 0.01;

export * from "./analytics/posthog.js";

export * from "./billing/packages.js";
export * from "./billing/trial-identity.js";
export * from "./billing/ledger.js";
export * from "./billing/paddle-events.js";

export * from "./email/send.js";
export * from "./email/welcome.js";

export * from "./keys/api-key.js";

// The hostname gate BOTH runtimes have to agree on: which names are non-public, and what a
// tracked domain canonicalizes to. Promoted here from apps/mcp on 2026-08-13 because the web
// action could not reach it and was opening projects the MCP tools refused — and a second copy
// of a reserved-TLD list is worse than the gap it closes.
export * from "./net/hostname.js";

// GSC at-rest token crypto + the bare-fetch Google Search Console client. Promoted here
// from apps/mcp so the web OAuth routes consume one BUILT implementation (no @pseo/mcp
// source deep-import / transpile) and the MCP `pull_gsc_data` read path shares the exact
// same seal format + client.
export * from "./gsc/crypto.js";
export * from "./gsc/client.js";
// Pure property-string rules, shared because BOTH runtimes need them: the web connection
// flow and the MCP tools must agree on what a property points at and who may query it.
export * from "./gsc/property.js";

// The "where does this project stand" half of the guide, promoted from apps/mcp so apps/web can
// show the SAME next step and the SAME crawl summary the MCP tools return. Both are PURE — the
// tenant-scoped reads and the tool definitions stay in apps/mcp, which re-exports what moved.
// The ONE freshness window + the age vocabulary every guide surface quotes. Listed ahead of the
// ladder because the ladder's FRESHNESS_WINDOW_DAYS is now an alias of the value defined there.
export * from "./guide/freshness.js";
export * from "./guide/next-step.js";
export * from "./guide/crawl-summary.js";
// The pull half of the same story. Separate module, same discipline: a stored jobs.result is
// jsonb of unknown shape, and the two summarizers are told apart by SHAPE rather than tool name,
// so they can be tried in either order and at most one of them answers.
export * from "./guide/pull-summary.js";

// audit_content's engine: the pure join of Search Console demand against crawled titles/h1s.
// It reads two arrays and touches nothing else — no clock, no network, no database — so it
// belongs here rather than in apps/mcp, and the tool that sells it stays a thin wrapper.
export * from "./content/title-query-match.js";
