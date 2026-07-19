import { sha256hex } from "@pseo/core";

/**
 * Personal-API-key authentication for the MCP gateway. This module is the DOMAIN
 * layer: it owns the auth flow and the per-key rate limit but has no direct DB
 * dependency. Storage is injected as `lookup`/`stamp` ports (db.ts wires the real
 * Supabase adapters), so the whole flow is unit-testable without a database.
 *
 * The plaintext key is treated as a secret: it is hashed (sha256, via @pseo/core)
 * before it ever reaches storage, and it is never logged — at most its safe prefix.
 */

/** Personal-API-key prefix (see @pseo/core keys). */
const API_KEY_PREFIX = "sg_";
/** Safe-to-log identifier length: `sg_` + 8 base58 chars — never the full key. */
const SAFE_PREFIX_LENGTH = 11;

/** Rate-limit defaults: 60 tokens refilling at 1/second = 60 requests/minute. */
const DEFAULT_CAPACITY = 60;
const DEFAULT_REFILL_PER_SECOND = 1;

/** The tenant identity a resolved personal key maps to. */
export interface AuthContext {
  readonly userId: string;
  readonly keyId: string;
}

/** The minimal active-key record the authenticator needs from storage. */
export interface KeyRecord {
  readonly keyId: string;
  readonly userId: string;
}

/** Look up an ACTIVE key by its sha256 hash. Resolves null when unknown OR revoked. */
export type KeyLookup = (keyHash: string) => Promise<KeyRecord | null>;

/** Stamp a key's last-used time. Called fire-and-forget; must never block auth. */
export type KeyStamp = (keyId: string, at: Date) => Promise<void>;

/** Resolve a plaintext personal key to its tenant context, or null. */
export type Authenticator = (key: string) => Promise<AuthContext | null>;

export interface AuthenticatorDeps {
  readonly lookup: KeyLookup;
  /** Optional last-used stamp; when omitted, successful auth performs no write. */
  readonly stamp?: KeyStamp;
  /** Injectable clock (defaults to Date). Tests pin it for determinism. */
  readonly now?: () => Date;
  /** Error sink for the fire-and-forget stamp (defaults to console.error). */
  readonly onError?: (message: string) => void;
  /** Test seam: receives the in-flight stamp promise so a caller can await it. */
  readonly onStamp?: (settled: Promise<void>) => void;
}

/** True when `key` has the personal-API-key shape (sg_ prefix + non-empty body). */
export function hasValidKeyFormat(key: string): boolean {
  return key.startsWith(API_KEY_PREFIX) && key.length > API_KEY_PREFIX.length;
}

/** First 11 chars of a key (`sg_` + 8 base58) — safe to log. Never the full key. */
export function safeKeyPrefix(key: string): string {
  return key.slice(0, SAFE_PREFIX_LENGTH);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build an authenticator over injected storage ports. Flow:
 *   1. format gate — fast reject, no I/O (the sg_ shape is public, not a secret);
 *   2. sha256-hash the key, then look up an ACTIVE row;
 *   3. miss -> null (unknown and revoked are indistinguishable — no info leak);
 *   4. hit  -> the tenant AuthContext.
 * On a hit, last_used_at is stamped fire-and-forget: the stamp is never awaited and
 * a stamp failure is only logged (with the safe prefix), so it can never block or
 * fail authentication.
 */
export function createAuthenticator(deps: AuthenticatorDeps): Authenticator {
  const now = deps.now ?? ((): Date => new Date());
  const onError = deps.onError ?? ((message: string): void => console.error(message));
  return async (key: string): Promise<AuthContext | null> => {
    if (!hasValidKeyFormat(key)) return null;
    const record = await deps.lookup(sha256hex(key));
    if (record === null) return null;
    if (deps.stamp !== undefined) {
      const settled = deps
        .stamp(record.keyId, now())
        .catch((error: unknown) =>
          onError(`last_used_at stamp failed for ${safeKeyPrefix(key)}: ${errorMessage(error)}`),
        );
      deps.onStamp?.(settled);
    }
    return { userId: record.userId, keyId: record.keyId };
  };
}

/** In-memory, per-key rate limiter. */
export interface RateLimiter {
  /** Consume one token for `id`; true = allowed, false = over the limit. */
  tryConsume(id: string): boolean;
}

export interface RateLimiterOptions {
  /** Bucket capacity / max burst. Default 60. */
  readonly capacity?: number;
  /** Tokens refilled per second. Default 1 (60/minute). */
  readonly refillPerSecond?: number;
  /** Injectable clock in milliseconds (defaults to Date.now). Tests pin it. */
  readonly now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedMs: number;
}

/**
 * Token-bucket rate limiter — one bucket per id, held in process memory. Buckets
 * start full so a fresh key gets its whole allowance immediately; tokens then refill
 * at `refillPerSecond` up to `capacity`. Deterministic under an injected clock.
 *
 * In-memory is deliberate for this slice: it is per-process (a multi-instance
 * deployment shares nothing), which is an accepted limitation until a shared store
 * lands. It is abuse smoothing per key, not a global quota.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const refillPerSecond = options.refillPerSecond ?? DEFAULT_REFILL_PER_SECOND;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();
  return {
    tryConsume(id: string): boolean {
      const nowMs = now();
      const bucket = buckets.get(id) ?? { tokens: capacity, updatedMs: nowMs };
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
