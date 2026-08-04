/**
 * Flood throttling for the PUBLIC web surface — the anonymous waitlist POST
 * (app/api/waitlist) and the anonymous public report read (lib/reports). Both spend real
 * resources per request (paid Resend/PostHog calls; a service-role Supabase read) and
 * neither sits behind auth, so each needs a cheap ceiling in front of it.
 *
 * The token bucket is the same shape the MCP gateway already runs per API key and per
 * client IP (apps/mcp/src/auth.ts). It is duplicated here rather than imported because
 * apps/web does not depend on the MCP package.
 *
 * WHAT THIS PROTECTS — AND WHAT IT DOES NOT.
 *
 * Buckets live in THIS process's memory. The web app is deployed to Netlify, which serves
 * Next through serverless functions: several instances can run at once, each starting with
 * an empty map, and any instance can be recycled between requests (losing its buckets
 * entirely). The effective ceiling is therefore (per-instance limit x live instances), and
 * that multiplier is not measured anywhere — so this is NOT a global quota and nothing here
 * should be read as claiming one.
 *
 * What it does buy: a hard per-instance cap on how much a single naive flood can spend
 * before it starts being refused, which is the whole of the observed problem (an unmetered
 * loop against one endpoint). It does not stop a distributed flood, and it does not stop an
 * attacker who rotates the client IP. Closing those needs a shared store (Redis/Upstash) or
 * an edge rule; this fix deliberately takes on neither.
 */

/** In-memory, per-id rate limiter. */
export interface RateLimiter {
  /** Consume one token for `id`; true = allowed, false = over the limit. */
  tryConsume(id: string): boolean;
}

export interface RateLimiterOptions {
  /** Bucket capacity — the burst a caller seen for the first time gets immediately. */
  readonly capacity: number;
  /** Tokens refilled per second; this is the sustained rate once the burst is spent. */
  readonly refillPerSecond: number;
  /**
   * Cap on the number of distinct buckets held in memory. When admitting a NEW id would
   * push the map past this, the WHOLE map is cleared first — crude but bounded, no LRU.
   * Same tradeoff the MCP limiter documents: a caller rotating more than `maxEntries` ids
   * already defeats per-id accounting, so this bounds MEMORY, not fairness.
   */
  readonly maxEntries?: number;
  /** Injectable clock in milliseconds (defaults to Date.now); tests pin it. */
  readonly now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedMs: number;
}

/**
 * Token bucket — one bucket per id. Buckets start full so a first-time caller gets its
 * whole allowance immediately; tokens then refill at `refillPerSecond` up to `capacity`.
 * Deterministic under an injected clock.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerSecond, maxEntries } = options;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();
  return {
    tryConsume(id: string): boolean {
      const nowMs = now();
      const existing = buckets.get(id);
      if (existing === undefined && maxEntries !== undefined && buckets.size >= maxEntries) {
        buckets.clear();
      }
      const bucket = existing ?? { tokens: capacity, updatedMs: nowMs };
      const elapsedSeconds = Math.max(0, (nowMs - bucket.updatedMs) / 1000);
      const refilled = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
      if (refilled < 1) {
        buckets.set(id, { tokens: refilled, updatedMs: nowMs });
        return false;
      }
      buckets.set(id, { tokens: refilled - 1, updatedMs: nowMs });
      return true;
    },
  };
}

/** Netlify's edge sets this on every proxied request, overwriting any client-supplied value. */
const NETLIFY_CLIENT_IP_HEADER = "x-nf-client-connection-ip";
const FORWARDED_FOR_HEADER = "x-forwarded-for";

/** Bucket key used when no caller address can be determined. */
export const UNKNOWN_CLIENT = "unknown";

/**
 * Best-effort caller address, used ONLY as a throttle bucket key — never for auth and never
 * persisted. Prefers the Netlify edge header, which the platform controls. Falls back to the
 * LEFTMOST x-forwarded-for entry, which IS client-forgeable: that path exists for local dev
 * and any non-Netlify host, and forging it only hands the forger a fresh bucket, so the
 * throttle degrades toward doing nothing rather than misfiring on an innocent address.
 * Missing both, every such caller shares one "unknown" bucket, which is still bounded.
 */
export function clientIpFromHeaders(requestHeaders: Headers): string {
  const edgeIp = requestHeaders.get(NETLIFY_CLIENT_IP_HEADER)?.trim();
  if (edgeIp) return edgeIp;
  const forwardedFor = requestHeaders.get(FORWARDED_FOR_HEADER)?.split(",")[0]?.trim();
  return forwardedFor ? forwardedFor : UNKNOWN_CLIENT;
}
