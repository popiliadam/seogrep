import { describe, expect, it, vi } from "vitest";
import {
  checkPublicHost,
  isBlockedIp,
  type LookupFn,
  nonPublicHostnameReason,
} from "./ssrf.ts";

/**
 * Pure-unit tests for the SSRF guard. No real network: checkPublicHost's DNS is a fake
 * LookupFn, and isBlockedIp / nonPublicHostnameReason are pure. These pin the blocklist
 * ranges (incl. IPv4-mapped, NAT64, and the Fly 6PN ULA), the non-public-name gate, and
 * checkPublicHost's fail-closed + short-circuit behavior.
 */

describe("isBlockedIp", () => {
  const blocked = [
    ["IPv4 unspecified", "0.0.0.0"],
    ["private 10/8", "10.0.0.5"],
    ["CGNAT 100.64/10", "100.64.1.1"],
    ["loopback 127/8", "127.0.0.1"],
    ["link-local / metadata 169.254/16", "169.254.169.254"],
    ["private 172.16/12 upper edge", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.1"],
    ["benchmarking 198.18/15", "198.19.0.1"],
    ["TEST-NET-2 198.51.100/24", "198.51.100.7"],
    ["reserved 240/4", "240.0.0.1"],
    ["multicast 224/4", "224.0.0.1"],
    ["Fly 6PN ULA fdaa::/16", "fdaa:0:1::1"],
    ["IPv6 link-local fe80::/10", "fe80::1"],
    ["IPv6 loopback ::1", "::1"],
    ["IPv6 unspecified ::", "::"],
    ["bracketed IPv6 loopback [::1]", "[::1]"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped private", "::ffff:10.0.0.5"],
    ["NAT64 well-known prefix", "64:ff9b::a00:1"],
    ["documentation 2001:db8::/32", "2001:db8::1"],
    ["garbage (fail closed)", "not-an-ip"],
    ["empty (fail closed)", ""],
  ] as const;
  for (const [label, ip] of blocked) {
    it(`blocks ${label} (${ip})`, () => {
      expect(isBlockedIp(ip)).toBe(true);
    });
  }

  const allowed = [
    ["public IPv4 8.8.8.8", "8.8.8.8"],
    ["public IPv4 1.1.1.1", "1.1.1.1"],
    ["public IPv6 Cloudflare", "2606:4700::1111"],
  ] as const;
  for (const [label, ip] of allowed) {
    it(`allows ${label} (${ip})`, () => {
      expect(isBlockedIp(ip)).toBe(false);
    });
  }
});

describe("nonPublicHostnameReason", () => {
  const nonPublic = [
    "foo.internal",
    "metadata.google.internal",
    "x.local",
    "a.test",
    "b.example",
    "sub.home.arpa",
    "metadata", // single label
  ];
  for (const host of nonPublic) {
    it(`flags ${host} as non-public`, () => {
      expect(nonPublicHostnameReason(host)).not.toBeNull();
    });
  }

  const publicHosts = ["example.com", "www.seogrep.com"];
  for (const host of publicHosts) {
    it(`allows ${host}`, () => {
      expect(nonPublicHostnameReason(host)).toBeNull();
    });
  }

  it("lowercases and strips a trailing dot before deciding", () => {
    expect(nonPublicHostnameReason("Metadata.Google.Internal.")).not.toBeNull();
    expect(nonPublicHostnameReason("EXAMPLE.COM.")).toBeNull();
  });
});

describe("checkPublicHost", () => {
  const one = (address: string, family = 4): LookupFn => async () => [{ address, family }];

  it("passes a host that resolves to a public address", async () => {
    const result = await checkPublicHost("seogrep.com", one("93.184.216.34"));
    expect(result.ok).toBe(true);
  });

  it("fails a host that resolves to a private address, without echoing the IP", async () => {
    const result = await checkPublicHost("intranet.example-corp.com", one("10.0.0.5"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/non-public address/i);
      expect(result.reason).not.toContain("10.0.0.5");
    }
  });

  it("fails when ANY resolved address is blocked (mixed public + private)", async () => {
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.9", family: 4 },
    ];
    const result = await checkPublicHost("mixed.example-corp.com", lookup);
    expect(result.ok).toBe(false);
  });

  it("fails closed when the lookup throws", async () => {
    const lookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    const result = await checkPublicHost("broken.example-corp.com", lookup);
    expect(result.ok).toBe(false);
  });

  it("fails when the lookup returns zero addresses", async () => {
    const lookup: LookupFn = async () => [];
    const result = await checkPublicHost("empty.example-corp.com", lookup);
    expect(result.ok).toBe(false);
  });

  it("short-circuits an IP-literal host WITHOUT calling the lookup", async () => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: "8.8.8.8", family: 4 }]);
    const blocked = await checkPublicHost("169.254.169.254", lookup);
    expect(blocked.ok).toBe(false);
    const bracketed = await checkPublicHost("[::1]", lookup);
    expect(bracketed.ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("short-circuits a non-public NAME before spending a DNS lookup", async () => {
    const lookup = vi.fn<LookupFn>(async () => [{ address: "8.8.8.8", family: 4 }]);
    const result = await checkPublicHost("foo.internal", lookup);
    expect(result.ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });
});
