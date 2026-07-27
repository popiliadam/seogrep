/**
 * DNS-rebinding pin for the SeoGrep crawler — the FETCH half of the SSRF guard.
 *
 * ssrf.ts decides whether a host is safe; this module makes the request actually go
 * there. Validation resolves a name once and vets every address it gets back, but a plain
 * `fetch()` then performs its OWN, independent resolution — so a hostile authoritative
 * server can answer the validation lookup with a public IP and the fetch's lookup with an
 * internal one (a low-TTL "DNS rebind") and walk straight past the guard. The close is to
 * take the address validation already approved and force the SOCKET onto it, so no second
 * resolution ever happens.
 *
 * The seam is an undici `Agent` whose connect options override `lookup`: undici spreads
 * those options into net/tls.connect, so this callback — not the system resolver — decides
 * the peer. Nothing else about the request changes. The URL still carries the original
 * hostname, so the `Host` header is untouched and virtual-hosted sites keep working, and
 * `servername` keeps TLS SNI on that same name, so certificate validation still checks the
 * NAME we meant to talk to: a pin can never be used to accept the wrong certificate.
 *
 * IP-LITERAL HOSTS: a literal makes fetch() resolve nothing, so there is no rebinding
 * window to close. resolveAndPin pins it to itself and makes NO admissibility ruling —
 * whether a literal may be fetched at all stays with the callers' existing gates (crawl.ts's
 * origin gate, with its documented loopback test seam, and validateRedirectTarget's blanket
 * refusal of literal redirect targets). This module must never become a second SSRF policy
 * that can drift from those.
 */

import { isIP, type LookupFunction } from "node:net";
import { Agent, type Dispatcher } from "undici";
import { checkPublicHost, type LookupFn } from "./ssrf.ts";

/** A hostname together with the exact address a validated lookup approved for it. */
export interface PinnedTarget {
  readonly hostname: string;
  readonly ip: string;
}

/** A fetch init carrying undici's `dispatcher` extension. */
type PinnedRequestInit = Omit<RequestInit, "dispatcher"> & { readonly dispatcher: Dispatcher };

/**
 * Attach a pinned dispatcher to a fetch init. Node's global fetch IS undici underneath and
 * honours `dispatcher`, but the ambient `RequestInit` in this project's lib set does not
 * declare that extension — so this is THE ONE place the two are reconciled, and every call
 * site stays a plain, cast-free `fetch(url, withPin(init, dispatcher))`.
 */
export function withPin(init: RequestInit, dispatcher: Dispatcher): RequestInit {
  const pinned: PinnedRequestInit = { ...init, dispatcher };
  return pinned as RequestInit;
}

/** IPv6 hostnames arrive bracketed from URL.hostname; sockets want the bare address. */
function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * The undici connect options that force a socket onto `target.ip` while it keeps
 * addressing `target.hostname`. Exported so both halves of that contract — the pin and the
 * SNI name — are unit-testable without a real TLS handshake.
 *
 * `lookup` answers BOTH shapes Node uses: an address array when it asks for `all` (the
 * autoSelectFamily path Node 22 takes) and the classic (address, family) triple otherwise.
 * A pin that is not a parseable IP fails CLOSED — it is never handed on as a NAME for the
 * real resolver to chase.
 */
export function pinnedConnectOptions(target: PinnedTarget): {
  readonly servername: string;
  readonly lookup: LookupFunction;
} {
  const family = isIP(target.ip);
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (family === 0) {
      callback(new Error("pinned address is not an IP"), []);
      return;
    }
    if (options.all === true) callback(null, [{ address: target.ip, family }]);
    else callback(null, target.ip, family);
  };
  return { servername: target.hostname, lookup };
}

/**
 * A dispatcher whose sockets go to `target.ip` while the request keeps addressing
 * `target.hostname`. ONE Agent per pinned target by design: undici pools connections per
 * origin, so a shared Agent could hand a later hop a socket that was opened for a
 * DIFFERENT vetted address. Callers own its lifetime and destroy() it once the response
 * body has been read.
 */
export function makePinnedDispatcher(target: PinnedTarget): Dispatcher {
  return new Agent({ connect: pinnedConnectOptions(target) });
}

/**
 * Validate `rawUrl`'s host through the SAME gate as everywhere else (checkPublicHost) and
 * return the address to pin, or the reason the host is refused.
 *
 * The pinned address comes OUT of the validating lookup — the very addresses isBlockedIp
 * approved — never from a second resolution, which is precisely the hole this closes. A
 * capturing wrapper records the answer while checkPublicHost stays the only thing that
 * judges it: exactly ONE resolution, exactly ONE policy.
 */
export async function resolveAndPin(
  rawUrl: string,
  lookup: LookupFn,
): Promise<{ ip: string } | { blocked: string }> {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    return { blocked: "invalid URL" };
  }

  // IP literal: fetch() resolves nothing, so pin it to itself (see the module docstring —
  // admissibility belongs to the callers' gates, not here).
  const literal = stripBrackets(hostname);
  if (isIP(literal) !== 0) return { ip: literal };

  let resolved: ReadonlyArray<{ address: string; family: number }> = [];
  const capturing: LookupFn = async (host) => {
    resolved = await lookup(host);
    return resolved;
  };

  const check = await checkPublicHost(hostname, capturing);
  if (!check.ok) return { blocked: check.reason };

  // checkPublicHost only says ok for a NAME after a non-empty, fully vetted answer, so
  // this is defence in depth rather than a reachable branch.
  const first = resolved[0]?.address;
  return first === undefined ? { blocked: "DNS resolution returned no addresses" } : { ip: first };
}

/**
 * Validate and pin `rawUrl` in one step: the dispatcher a crawler fetch must go out
 * through, or the reason NO request may be emitted for it at all.
 */
export async function pinnedDispatcherFor(
  rawUrl: string,
  lookup: LookupFn,
): Promise<{ dispatcher: Dispatcher } | { blocked: string }> {
  const pin = await resolveAndPin(rawUrl, lookup);
  if ("blocked" in pin) return pin;
  const hostname = stripBrackets(new URL(rawUrl).hostname);
  return { dispatcher: makePinnedDispatcher({ hostname, ip: pin.ip }) };
}
