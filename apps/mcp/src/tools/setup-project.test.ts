import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth.ts";
import type { DomainReachability } from "./domain-reachability.ts";
import { makeSetupProjectTool, normalizeDomain } from "./setup-project.ts";

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

  /**
   * S4. The canonical form drops a leading `www.` — the difference between one project per site
   * and two. Measured live 2026-08-25: `https://www.seogrep.com/pricing?utm_source=…` opened a
   * SECOND project beside `seogrep.com`, while the tool's own description promised idempotency.
   */
  it("drops a leading `www.` so one site canonicalizes to ONE domain", () => {
    for (const raw of ["www.example.com", "https://www.example.com/x?y=1", "WWW.Example.com"]) {
      expect(normalizeDomain(raw)).toEqual({ ok: true, domain: "example.com" });
    }
  });

  it("drops ONLY `www.` — a subdomain is a different site and stays one", () => {
    expect(normalizeDomain("blog.example.com")).toEqual({ ok: true, domain: "blog.example.com" });
  });

  it("still accepts a normal public domain", () => {
    expect(normalizeDomain("example.com")).toEqual({ ok: true, domain: "example.com" });
  });
});

/**
 * THE REACHABILITY WARNING (S17). Measured 2026-08-25:
 * `setup_project("bu-domain-kesinlikle-yok-9f3a2c.com")` answered
 * `Created project … (created: true)` in the same successful tone as a real site, with no
 * warning — and whats_next then recommended a 20-credit crawl against it.
 *
 * Both ports are injected, so these specs make no DB call and no DNS query. The operator signed
 * WARN, not block, so every case below asserts the project was still created.
 */
describe("setup_project — the domain-does-not-resolve warning", () => {
  const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

  function tool(reachability: DomainReachability, seen: string[] = []) {
    return makeSetupProjectTool({
      openProject: async (_userId, raw) => {
        const normalized = normalizeDomain(raw);
        if (!normalized.ok) return { ok: false, error: normalized.error };
        return {
          ok: true,
          project: { id: "p-1", domain: normalized.domain, outcome: "created" },
        };
      },
      checkDomain: async (domain) => {
        seen.push(domain);
        return reachability;
      },
    });
  }

  async function textOf(reachability: DomainReachability, domain = "bu-domain-yok-9f3a2c.com") {
    const result = await tool(reachability).run(CTX, { domain });
    expect(result.isError).toBeUndefined();
    return result.content[0]?.text ?? "";
  }

  it("warns AND still registers when the domain does not resolve", async () => {
    const text = await textOf("no_such_domain");
    // Both halves of the signed behaviour, in one assertion pair: the project exists...
    expect(text).toMatch(/created: true/);
    expect(text).toContain("project_id: p-1");
    // ...and the answer no longer reads as an unqualified success.
    expect(text).toMatch(/does not resolve/i);
  });

  it("says nothing extra for a domain that resolves", async () => {
    const text = await textOf("resolves", "seogrep.com");
    expect(text).toMatch(/created: true/);
    expect(text).not.toMatch(/does not resolve/i);
    expect(text).not.toMatch(/heads up/i);
  });

  /**
   * THE FAILURE SEMANTICS, at the tool's own surface. A lookup that timed out or whose resolver
   * was unreachable must be indistinguishable from one that succeeded — silence, not an
   * accusation. This is the case a network blip produces, and it is the one that would otherwise
   * warn on every registration in the account.
   */
  it("stays silent when the check could not run — a blip is not a missing domain", async () => {
    const text = await textOf("unknown");
    expect(text).toMatch(/created: true/);
    expect(text).not.toMatch(/does not resolve/i);
    expect(text).toBe(await textOf("resolves", "bu-domain-yok-9f3a2c.com"));
  });

  /**
   * It asks about the CANONICAL name. The `www.` normalization landed earlier in this wave and a
   * check that queried the raw input would be checking a different host than the crawler will
   * fetch — and would answer for `www.` sites that publish only an apex record, or the reverse.
   */
  it("checks the normalized domain, not the string the caller pasted", async () => {
    const seen: string[] = [];
    await tool("resolves", seen).run(CTX, { domain: "HTTPS://WWW.Example.com/pricing?x=1" });
    expect(seen).toEqual(["example.com"]);
  });

  it("runs no check at all when the domain never became a project", async () => {
    const seen: string[] = [];
    const result = await tool("no_such_domain", seen).run(CTX, { domain: "not a domain" });
    expect(result.isError).toBe(true);
    expect(seen).toEqual([]);
  });
});

/**
 * THE RECEIPT'S OWN TWO CLAIMS — added 2026-08-26 (smoke turu dalga 2, bulgular D-2 · D-4).
 *
 * Measured on the live tool: a registration answered `Created project for "xn--rnek-4qa.com"` to
 * a customer who typed `örnek.com`, and then said nothing at all about what to do with the id it
 * had just minted. Neither is a wording preference — the first shows a name the customer cannot
 * recognise as their own site, and the second ends the setup path in silence.
 */
describe("setup_project — the receipt names the site and points somewhere", () => {
  const CTX: AuthContext = { userId: "user-1", keyId: "key-1" };

  function toolWith(outcome: "created" | "existing" | "restored") {
    return makeSetupProjectTool({
      openProject: async (_userId, raw) => {
        const normalized = normalizeDomain(raw);
        if (!normalized.ok) return { ok: false, error: normalized.error };
        return { ok: true, project: { id: "p-1", domain: normalized.domain, outcome } };
      },
      checkDomain: async () => "resolves",
    });
  }

  async function textOf(outcome: "created" | "existing" | "restored", domain: string) {
    const result = await toolWith(outcome).run(CTX, { domain });
    expect(result.isError).toBeUndefined();
    return result.content[0]?.text ?? "";
  }

  it("shows an IDN project as the customer typed it, WITH the stored A-label", async () => {
    const text = await textOf("created", "örnek.com");
    expect(text).toContain("örnek.com");
    // The A-label is not hidden: it is what a DNS panel and every join downstream will show.
    expect(text).toContain("xn--rnek-4qa.com");
  });

  it("leaves an ASCII domain exactly as it is — no parenthesis, no second spelling", async () => {
    const text = await textOf("created", "seogrep.com");
    expect(text).toContain('"seogrep.com"');
    expect(text).not.toContain("(seogrep.com)");
  });

  /**
   * SP-1 — the receipt's `created:` flag, measured 2026-09-02 as pinned NOWHERE in the fast
   * lane: forcing the "already exists" branch to print `created: true` left 143 files / 3680
   * tests green. The only pin was `setup-project.db.test.ts:121`, in a lane `make verify` does
   * not run (CLAUDE.md command table: "DB şeritleri YOK").
   *
   * The flag is the one machine-readable fact in the sentence — it answers "did this call MAKE
   * something?". A wrong `true` turns "you already had this site" into "I registered it for
   * you", and a caller that trusts it goes on to treat an old project as new.
   *
   * ALL THREE OUTCOMES, each with its own expected value (signed lesson 14, position axis):
   * pinning only the branch that says `false` would let a mutation that SWAPS the two stay
   * green. Asserted as a regex on the flag, never as the source literal (lesson 11).
   */
  it.each([
    ["created", "true"],
    ["existing", "false"],
    ["restored", "false"],
  ] as const)("the %s outcome stamps `created: %s`, and never the other value", async (outcome, flag) => {
    const text = await textOf(outcome, "seogrep.com");
    expect(text, outcome).toMatch(new RegExp(String.raw`created:\s*${flag}\b`, "i"));
    const opposite = flag === "true" ? "false" : "true";
    expect(text, outcome).not.toMatch(new RegExp(String.raw`created:\s*${opposite}\b`, "i"));
  });

  it("points at whats_next on ALL THREE outcomes, not just a fresh project", async () => {
    // The outcome axis is the one that matters here: a customer who re-runs setup_project on a
    // site they already have, or brings one back from the archive, is at exactly the same fork.
    for (const outcome of ["created", "existing", "restored"] as const) {
      expect(await textOf(outcome, "seogrep.com"), outcome).toMatch(/whats_next/);
    }
  });
});
