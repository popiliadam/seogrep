/**
 * SSRF guard for the SeoGrep crawler — post-DNS IP blocklist + non-public-name checks.
 *
 * THREAT MODEL
 * The crawl runs on a Fly worker that HAS 6PN internal-network access. Tenant-controlled
 * input (a registered domain, a robots.txt / sitemap redirect Location, a sitemapindex
 * <loc>) must never be able to steer our fetcher at an internal address: loopback,
 * RFC1918 / CGNAT, link-local (incl. the 169.254.169.254 cloud-metadata endpoint), or the
 * Fly 6PN ULA range (fdaa::/16, inside fc00::/7). String-level host checks alone are
 * insufficient — a *public* hostname can resolve (A/AAAA) to any of these addresses — so
 * the decisive check is on the RESOLVED IP, not on the name.
 *
 * Exports:
 *  - isBlockedIp(ip): pure range-membership test over the internal ranges, IPv4 and IPv6
 *    (incl. IPv4-mapped and NAT64 embeddings), fail-closed on unparseable input;
 *  - nonPublicHostnameReason(hostname): cheap string gate for single-label and
 *    reserved/internal TLDs (skips pointless DNS and closes names that never resolve);
 *  - checkPublicHost(hostname, lookup): resolves the name and fails if ANY resolved
 *    address is blocked. The DNS lookup is injectable so tests never touch real DNS.
 *
 * KNOWN RESIDUAL RISK — DNS REBINDING (deliberately NOT mitigated in this slice).
 * checkPublicHost validates the addresses returned by ONE lookup, but the subsequent
 * fetch() performs its OWN, independent resolution. A hostile authoritative server can
 * answer our validation lookup with a public IP and the fetch's lookup with an internal
 * IP (a low-TTL "DNS rebind"), slipping past this guard. Closing that gap requires pinning
 * the validated IP through the fetch dispatcher (a custom Undici connect hook) so the
 * socket connects to the exact address we vetted. That pinning is out of scope here and is
 * tracked separately — do NOT assume this module defends against rebinding.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Strip a single pair of surrounding brackets (URL.hostname keeps IPv6 bracketed). */
function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** Parse a dotted-quad into four octets (0-255); null if not a well-formed IPv4 string. */
function ipv4ToOctets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets; // length 4 by construction
}

/** Pack a dotted-quad into an unsigned 32-bit int; null if not well-formed. */
function ipv4ToInt(ip: string): number | null {
  const o = ipv4ToOctets(ip);
  if (o === null) return null;
  return (((o[0] ?? 0) << 24) | ((o[1] ?? 0) << 16) | ((o[2] ?? 0) << 8) | (o[3] ?? 0)) >>> 0;
}

/** Left-anchored /prefix netmask as an unsigned 32-bit int. */
function ipv4Mask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

/**
 * Internal / reserved IPv4 ranges the crawler must never reach. Kept as human-readable
 * CIDRs and precomputed to (base, mask) once at load. Covers loopback, RFC1918, CGNAT,
 * link-local (metadata), benchmarking, TEST-NET docs, multicast, and reserved space.
 */
const BLOCKED_V4: ReadonlyArray<{ base: number; mask: number }> = (
  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as ReadonlyArray<readonly [string, number]>
).map(([cidr, prefix]) => ({ base: ipv4ToInt(cidr) ?? 0, mask: ipv4Mask(prefix) }));

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // fail closed
  return BLOCKED_V4.some(({ base, mask }) => ((value & mask) >>> 0) === ((base & mask) >>> 0));
}

/**
 * Expand a textual IPv6 address into its 16 bytes; null if it does not parse. Handles
 * "::" zero-compression and an embedded IPv4 tail (e.g. ::ffff:127.0.0.1). Callers reach
 * this only for isIP()===6 inputs, but it fails closed (null) on anything malformed.
 */
function ipv6ToBytes(input: string): Uint8Array | null {
  let ip = input;
  const pct = ip.indexOf("%");
  if (pct !== -1) ip = ip.slice(0, pct); // drop any zone id

  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const expand = (segment: string): number[] | null => {
    if (segment === "") return [];
    const out: number[] = [];
    const groups = segment.split(":");
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] ?? "";
      if (g.includes(".")) {
        if (i !== groups.length - 1) return null; // embedded IPv4 only in the last group
        const octets = ipv4ToOctets(g);
        if (octets === null) return null;
        out.push(octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        const word = Number.parseInt(g, 16);
        out.push((word >> 8) & 0xff, word & 0xff);
      }
    }
    return out;
  };

  const head = expand(halves[0] ?? "");
  if (head === null) return null;

  if (halves.length === 1) {
    if (head.length !== 16) return null; // no "::" → must be fully specified
    return Uint8Array.from(head);
  }

  const tail = expand(halves[1] ?? "");
  if (tail === null || head.length + tail.length > 16) return null;

  const bytes = new Uint8Array(16);
  bytes.set(head, 0);
  bytes.set(tail, 16 - tail.length);
  return bytes;
}

function isBlockedIpv6(bytes: Uint8Array): boolean {
  const b = (i: number): number => bytes[i] ?? 0;
  const allZero = (start: number, end: number): boolean => {
    for (let i = start; i < end; i++) if (b(i) !== 0) return false;
    return true;
  };
  // ::ffff:0:0/96 — IPv4-mapped: apply the IPv4 rules to the embedded address.
  if (allZero(0, 10) && b(10) === 0xff && b(11) === 0xff) {
    return isBlockedIpv4(`${b(12)}.${b(13)}.${b(14)}.${b(15)}`);
  }
  // :: (unspecified) and ::1 (loopback).
  if (allZero(0, 15) && (b(15) === 0 || b(15) === 1)) return true;
  // ::/96 — deprecated IPv4-compatible (RFC 4291): bytes 0-11 zero, an embedded IPv4 in
  // bytes 12-15. Mirror the IPv4-mapped branch and apply the IPv4 rules so an embedded
  // loopback/private address (e.g. ::127.0.0.1) can't slip through. :: and ::1 are already
  // returned above, so this only fires for a non-trivial embedded IPv4.
  if (allZero(0, 12)) {
    return isBlockedIpv4(`${b(12)}.${b(13)}.${b(14)}.${b(15)}`);
  }
  // 64:ff9b::/96 — NAT64 well-known prefix (block outright).
  if (b(0) === 0x00 && b(1) === 0x64 && b(2) === 0xff && b(3) === 0x9b && allZero(4, 12)) return true;
  // fc00::/7 — ULA (this is what covers Fly 6PN fdaa::/16).
  if ((b(0) & 0xfe) === 0xfc) return true;
  // fe80::/10 — link-local.
  if (b(0) === 0xfe && (b(1) & 0xc0) === 0x80) return true;
  // ff00::/8 — multicast.
  if (b(0) === 0xff) return true;
  // 2001:db8::/32 — documentation.
  if (b(0) === 0x20 && b(1) === 0x01 && b(2) === 0x0d && b(3) === 0xb8) return true;
  return false;
}

/**
 * True when `ip` is a loopback / private / link-local / reserved address the crawler must
 * refuse. Pure, no I/O. Accepts bracketed IPv6 ([::1]). Fails CLOSED: anything that is not
 * a parseable IP (isIP()===0 after stripping brackets) is treated as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const host = stripBrackets(ip);
  const family = isIP(host);
  if (family === 4) return isBlockedIpv4(host);
  if (family === 6) {
    const bytes = ipv6ToBytes(host);
    return bytes === null ? true : isBlockedIpv6(bytes);
  }
  return true; // family === 0 → unparseable → fail closed
}

/** Hostnames whose last label marks a non-public / reserved / internal namespace. */
const NON_PUBLIC_TLDS: ReadonlySet<string> = new Set([
  "localhost",
  "local",
  "internal",
  "test",
  "invalid",
  "example",
  "onion",
  "lan",
  "home",
  "corp",
  "intranet",
  "private",
]);

/**
 * Short English reason when `hostname` is a non-public name, else null. Pure. Lowercases
 * and strips a trailing dot first. Non-public when: it is a single label (no dot); its last
 * label is a reserved/internal pseudo-TLD; or it is `home.arpa` / `*.home.arpa`. IP literals
 * are NOT this function's concern — callers vet those with isBlockedIp.
 */
export function nonPublicHostnameReason(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (!host.includes(".")) return "single-label (non-public) hostname";
  if (host === "home.arpa" || host.endsWith(".home.arpa")) return "reserved home.arpa name";
  const lastLabel = host.slice(host.lastIndexOf(".") + 1);
  if (NON_PUBLIC_TLDS.has(lastLabel)) return `non-public TLD ".${lastLabel}"`;
  return null;
}

/** Injectable DNS resolver (all A/AAAA records). Faked in tests so DNS is never real. */
export type LookupFn = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

/** Default resolver backed by node:dns/promises. */
export const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

/**
 * Resolve `hostname` and decide whether it is safe to fetch. A bracketed / IP-literal
 * hostname is decided by isBlockedIp with NO DNS. Otherwise the cheap string gate runs
 * first (avoids a pointless lookup), then every resolved address must be public — a single
 * blocked address fails the host. Reasons are generic by design (they surface in
 * tenant-visible skipped[].reason) and never echo the raw resolved IP.
 */
export async function checkPublicHost(
  hostname: string,
  lookup: LookupFn = defaultLookup,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const literal = stripBrackets(hostname);
  if (isIP(literal) !== 0) {
    return isBlockedIp(literal)
      ? { ok: false, reason: "IP literal is a non-public address" }
      : { ok: true };
  }

  const nameReason = nonPublicHostnameReason(hostname);
  if (nameReason !== null) return { ok: false, reason: nameReason };

  let addresses: ReadonlyArray<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch {
    return { ok: false, reason: "DNS resolution failed" };
  }
  if (addresses.length === 0) return { ok: false, reason: "DNS resolution returned no addresses" };
  for (const { address } of addresses) {
    if (isBlockedIp(address)) return { ok: false, reason: "resolves to a non-public address" };
  }
  return { ok: true };
}
