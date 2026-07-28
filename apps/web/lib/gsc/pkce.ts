import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * PKCE (RFC 7636) for the GSC OAuth link-out, and the one-time carrier that makes the signed
 * `state` non-replayable. Both properties come from ONE httpOnly cookie, so there is still no
 * server-side session store to keep, expire, or scale.
 *
 * WHY A COOKIE AT ALL. The state (lib/gsc/state) is a stateless MAC: it proves who asked and
 * that the request has not expired, but nothing in it can distinguish a first presentation
 * from a tenth. Its own docstring says so — "there is no server-side nonce store, so nothing
 * detects or rejects a replayed state". A state captured from a Referer header, a proxy log,
 * or a shared screen therefore stays usable for its whole TTL. The fix is a per-flow secret
 * the BROWSER holds and the callback destroys on use: present the state without it and there
 * is nothing to check it against. The cookie carries two things:
 *
 *   - the state's `nonce`, binding cookie and state to the same issuing flow, and
 *   - the PKCE `code_verifier`, whose S256 digest is what went to Google in the authorize URL.
 *
 * WHY PKCE ON A CONFIDENTIAL CLIENT. The client_secret already stops a stranger from redeeming
 * a stolen code, so this is defence in depth, not the only lock: it kills authorization-code
 * INJECTION, where an attacker's own code is delivered to a victim's callback to bind the
 * attacker's Google account to the victim's project. Google will only redeem a code against
 * the verifier whose digest it was issued for, and that verifier never leaves this origin.
 *
 * Node runtime only (node:crypto) — both GSC routes already declare it.
 */

/** Cookie name for the per-flow secret. */
export const PKCE_COOKIE = "gsc_oauth";

/**
 * Scoped to the GSC API routes: the only two handlers that issue or consume it. A narrower
 * path is not merely tidy — it keeps the secret off every other request the browser makes.
 */
export const PKCE_COOKIE_PATH = "/api/gsc";

/** The parsed cookie: the flow it belongs to, and the secret behind the code challenge. */
export interface PkceFlow {
  readonly nonce: string;
  readonly verifier: string;
}

/**
 * A fresh `code_verifier`: 32 CSPRNG bytes as base64url (43 chars, inside RFC 7636's 43-128
 * and already in the unreserved-character set, so it needs no further encoding).
 */
export function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The S256 challenge for a verifier — base64url(SHA-256(verifier)). Only this digest is ever
 * put in a URL; deriving the verifier back out of it is the hash's job to prevent.
 */
export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Pack {nonce, verifier} into a cookie value. Both halves are base64url/UUID text, so a single
 * "." can never appear inside either and is an unambiguous separator.
 */
export function serializePkceCookie(nonce: string, verifier: string): string {
  return `${nonce}.${verifier}`;
}

/** Unpack a cookie value. Anything malformed (or absent) is null — the caller fails closed. */
export function parsePkceCookie(raw: string | null | undefined): PkceFlow | null {
  if (!raw) return null;
  const separator = raw.indexOf(".");
  if (separator <= 0) return null;
  const nonce = raw.slice(0, separator);
  const verifier = raw.slice(separator + 1);
  if (!nonce || !verifier) return null;
  return { nonce, verifier };
}

/**
 * Read one cookie out of a request's `Cookie` header. Next's own cookie helpers want a Next
 * request; these routes take a bare `Request`, and one header parse is cheaper than adapting.
 */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

/**
 * Constant-time comparison of the cookie's nonce against the state's. The nonce is a secret in
 * this design (it is what an attacker replaying a captured state does NOT have), so it is
 * compared the same way the state MAC is — length first, then timingSafeEqual, which throws on
 * mismatched lengths.
 */
export function matchesNonce(fromCookie: string, fromState: string): boolean {
  const a = Buffer.from(fromCookie, "utf8");
  const b = Buffer.from(fromState, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/*
 * NOTE — getting the verifier onto the wire is deliberately NOT this module's job. It reaches
 * Google as `exchangeCodeForTokens`'s own `codeVerifier` parameter (see the callback route). A
 * `fetchWithCodeVerifier` wrapper used to live here and splice it into the request body through
 * the client's injectable `fetch`, because that client had no verifier parameter to pass it to.
 * That follow-up is done and the wrapper is gone: the body's wire format is no longer an
 * unwritten contract this file depends on.
 */
