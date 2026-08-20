/**
 * The two SERPs this product measures, as a value the RANK-TRACKER surfaces can read — and a
 * module with NO IMPORTS AT ALL, which is the whole reason it exists.
 *
 * WHY IT IS NOT `Object.keys(DEVICE_MEANS)` FROM dfs/serp.ts. That was the first version, and the
 * vendor-spend import-graph gate refused it (paid-balance.graph.test.ts — measured, not guessed): a
 * VALUE import from dfs/serp.ts reaches `reserveSpend` transitively, so deriving the list at
 * runtime made `keyword_positions` — a tool that reads stored rows and cannot spend a cent — look
 * like a tool that spends real DataForSEO money. The gate was right to refuse, and there are only
 * two honest answers to it: add the tools to the paid-balance allowlist (a lie: they spend
 * nothing, and gating a free registration tool behind a paid balance is a product change nobody
 * signed), or stop reaching the money module. This is the second.
 *
 * WHAT KEEPS IT HONEST INSTEAD. track-keywords.test.ts asserts this list is EXACTLY the port's own
 * device set — a spec may import dfs/serp.ts freely, because the scanner skips test files and no
 * shipped code path goes through it. So a third device in the port turns that spec red rather than
 * silently leaving a device this surface cannot name.
 *
 * The list is deliberately not exported from a tool module either: two tools and a store read it,
 * and a constant living in one of its own consumers is how an import cycle starts.
 */
export const SERP_DEVICES = ["desktop", "mobile"] as const;

/** One of the two devices above. Structurally identical to the port's `SerpDevice`, by spec. */
export type TrackedDevice = (typeof SERP_DEVICES)[number];
