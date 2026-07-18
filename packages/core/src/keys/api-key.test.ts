import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base58Encode,
  DEFAULT_MCP_URL_TEMPLATE,
  generateApiKey,
  mcpUrlFor,
  mcpUrlTemplate,
  sha256hex,
} from "./api-key.js";

/**
 * Pure API-key domain tests — part of the fast gate (no I/O, no live stack).
 * Randomness is injected so format/hash determinism can be pinned with fixed bytes;
 * a separate case uses real entropy to assert practical uniqueness.
 */

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("base58Encode", () => {
  // Bitcoin alphabet, big-endian, leading zero bytes -> leading '1's.
  it.each([
    { input: [] as number[], expected: "" },
    { input: [0], expected: "1" },
    { input: [0, 0], expected: "11" },
    { input: [1], expected: "2" },
    { input: [57], expected: "z" },
    { input: [58], expected: "21" },
    { input: [255], expected: "5Q" },
    { input: [1, 0], expected: "5R" },
    { input: [0, 1], expected: "12" },
  ])("encodes $input to $expected", ({ input, expected }) => {
    expect(base58Encode(bytes(...input))).toBe(expected);
  });

  it("never emits the ambiguous characters 0 O I l", () => {
    const out = base58Encode(bytes(...Array.from({ length: 64 }, (_, i) => (i * 7) % 256)));
    expect(out).not.toMatch(/[0OIl]/);
  });
});

describe("sha256hex", () => {
  // Well-known SHA-256 vectors.
  it("hashes the empty string", () => {
    expect(sha256hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'abc'", () => {
    expect(sha256hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic and 64 lowercase hex chars", () => {
    const digest = sha256hex("sg_example");
    expect(digest).toBe(sha256hex("sg_example"));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("generateApiKey", () => {
  const fixed = bytes(...Array.from({ length: 24 }, (_, i) => (i * 11 + 1) % 256));

  it("produces the sg_ + base58 format with an 11-char stored prefix", () => {
    const { key, prefix } = generateApiKey(() => fixed);
    expect(key).toBe(`sg_${base58Encode(fixed)}`);
    expect(key.startsWith("sg_")).toBe(true);
    expect(prefix).toBe(key.slice(0, 11));
    expect(prefix).toHaveLength(11);
    expect(prefix.startsWith("sg_")).toBe(true);
  });

  it("hashes the full plaintext key with SHA-256 (independent recomputation)", () => {
    const { key, hash } = generateApiKey(() => fixed);
    expect(hash).toBe(createHash("sha256").update(key, "utf8").digest("hex"));
  });

  it("is deterministic for the same injected bytes", () => {
    expect(generateApiKey(() => fixed)).toEqual(generateApiKey(() => fixed));
  });

  it("requests exactly 24 random bytes", () => {
    let requested = -1;
    generateApiKey((n) => {
      requested = n;
      return new Uint8Array(n);
    });
    expect(requested).toBe(24);
  });

  it("never repeats across 1000 real-entropy generations (key + hash + prefix distinct)", () => {
    const keys = new Set<string>();
    const hashes = new Set<string>();
    // 8 base58 chars after "sg_" ≈ 1.3e14 combinations — a 1000-draw collision is
    // ~4e-9, so asserting prefix distinctness is flake-free.
    const prefixes = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const { key, hash, prefix } = generateApiKey();
      expect(key.startsWith("sg_")).toBe(true);
      expect(prefix).toBe(key.slice(0, 11));
      expect(hash).toBe(createHash("sha256").update(key, "utf8").digest("hex"));
      keys.add(key);
      hashes.add(hash);
      prefixes.add(prefix);
    }
    expect(keys.size).toBe(1000);
    expect(hashes.size).toBe(1000);
    expect(prefixes.size).toBe(1000);
  });
});

describe("mcpUrlFor / mcpUrlTemplate", () => {
  it("substitutes the {key} placeholder", () => {
    expect(mcpUrlFor("sg_abc", "https://mcp.seogrep.com/mcp/{key}")).toBe(
      "https://mcp.seogrep.com/mcp/sg_abc",
    );
  });

  it("is pure — the same key + template always yields the same URL", () => {
    const template = "https://example.test/{key}/mcp";
    expect(mcpUrlFor("sg_xyz", template)).toBe(mcpUrlFor("sg_xyz", template));
    expect(mcpUrlFor("sg_xyz", template)).toBe("https://example.test/sg_xyz/mcp");
  });

  it("resolves the default template when MCP_URL_TEMPLATE is unset", () => {
    const previous = process.env.MCP_URL_TEMPLATE;
    delete process.env.MCP_URL_TEMPLATE;
    try {
      expect(mcpUrlTemplate()).toBe(DEFAULT_MCP_URL_TEMPLATE);
      expect(mcpUrlTemplate()).toBe("https://mcp.seogrep.com/mcp/{key}");
    } finally {
      if (previous !== undefined) process.env.MCP_URL_TEMPLATE = previous;
    }
  });

  it("honours a configured MCP_URL_TEMPLATE override", () => {
    const previous = process.env.MCP_URL_TEMPLATE;
    process.env.MCP_URL_TEMPLATE = "https://self.hosted/mcp/{key}";
    try {
      expect(mcpUrlFor("sg_abc", mcpUrlTemplate())).toBe("https://self.hosted/mcp/sg_abc");
    } finally {
      if (previous === undefined) delete process.env.MCP_URL_TEMPLATE;
      else process.env.MCP_URL_TEMPLATE = previous;
    }
  });
});
