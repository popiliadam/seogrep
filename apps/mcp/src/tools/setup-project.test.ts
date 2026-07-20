import { describe, expect, it } from "vitest";
import { normalizeDomain } from "./setup-project.ts";

/**
 * Unit tests for domain normalization (pure — no DB). A domain may arrive as a bare
 * host or a full URL; setup_project stores ONE canonical form so the same site is not
 * tracked twice. The DB idempotency + tenant scoping are proven in setup-project.db.test.ts.
 */

describe("normalizeDomain", () => {
  it("passes a already-canonical bare host through unchanged", () => {
    expect(normalizeDomain("example.com")).toEqual({ ok: true, domain: "example.com" });
  });

  it("extracts the host from a full URL and drops scheme / path / query", () => {
    expect(normalizeDomain("https://Example.com/blog/post?a=1")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("lowercases and keeps subdomains and multi-label TLDs", () => {
    expect(normalizeDomain("HTTP://Sub.Example.CO.UK")).toEqual({
      ok: true,
      domain: "sub.example.co.uk",
    });
  });

  it("strips a trailing dot (FQDN) and a trailing slash", () => {
    expect(normalizeDomain("example.com.")).toEqual({ ok: true, domain: "example.com" });
    expect(normalizeDomain("example.com/")).toEqual({ ok: true, domain: "example.com" });
  });

  it("trims surrounding whitespace and drops a port", () => {
    expect(normalizeDomain("  example.com:8080  ")).toEqual({ ok: true, domain: "example.com" });
  });

  it("rejects an empty or whitespace-only input with an English error", () => {
    expect(normalizeDomain("   ")).toEqual({ ok: false, error: expect.stringMatching(/empty|required/i) });
  });

  it("rejects a single-label host with no TLD", () => {
    const result = normalizeDomain("localhost");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/valid domain/i);
  });

  it("rejects a value with internal whitespace", () => {
    expect(normalizeDomain("not a domain").ok).toBe(false);
  });

  it("rejects a URL with no host", () => {
    expect(normalizeDomain("https://").ok).toBe(false);
  });

  it("rejects internal / reserved (non-public) names even when syntactically valid", () => {
    // These pass DOMAIN_RE but must never be tracked or crawled (SSRF surface).
    for (const raw of ["foo.internal", "metadata.google.internal", "a.local", "b.test"]) {
      const result = normalizeDomain(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/public domain|internal|reserved/i);
    }
  });

  it("still accepts a normal public domain", () => {
    expect(normalizeDomain("example.com")).toEqual({ ok: true, domain: "example.com" });
  });
});
