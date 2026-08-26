import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// The freshness detector for `gen-tool-docs --check`. It is a standalone Node module (the CLI is run
// with `node`), so this suite imports it the same way tool-docs-gen.test.ts imports the generator.
import {
  MEMO_BASENAME,
  MEMO_VERSION,
  assertDistFresh,
  distStampOf,
  findSuspects,
  fingerprintSources,
  isCompiledSource,
  memoRescues,
  outputRelFor,
  renderStaleMessage,
} from "../scripts/dist-freshness.mjs";

// ---------------------------------------------------------------------------
// Fixture: a miniature src/ + dist/ pair whose timestamps this suite controls exactly.
// Trees are left in place on purpose — nothing in this repo deletes files from a test, and the OS
// reclaims tmpdir. Each call gets its own directory, so tests never share state.
// ---------------------------------------------------------------------------

const SECOND = 1;
const BASE = 1_700_000_000; // fixed epoch seconds: every ordering below is explicit, never "now"

function tree() {
  const root = mkdtempSync(join(tmpdir(), "dist-freshness-"));
  const src = join(root, "src");
  const dist = join(root, "dist");
  mkdirSync(src, { recursive: true });
  mkdirSync(dist, { recursive: true });

  const put = (base: string, rel: string, content: string, atSecond: number) => {
    const path = join(base, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    utimesSync(path, atSecond, atSecond);
    return path;
  };

  return {
    root,
    src,
    dist,
    /** Write a source file, stamped `at` seconds. */
    source: (rel: string, content: string, at = BASE) => put(src, rel, content, at),
    /** Write a compiled output, stamped `at` seconds (default: 10s AFTER the sources). */
    output: (rel: string, content: string, at = BASE + 10 * SECOND) => put(dist, rel, content, at),
    memo: () => JSON.parse(readFileSync(join(dist, MEMO_BASENAME), "utf8")),
    check: () => assertDistFresh({ srcDir: src, distDir: dist, srcLabel: "apps/mcp/src", distLabel: "apps/mcp/dist" }),
  };
}

/** A fixture whose dist is a genuine build of its sources (outputs written after the sources). */
function freshTree() {
  const t = tree();
  t.source("tools/index.ts", "export const ALL_TOOLS = [];\n");
  t.source("credits/costs.ts", "export const TOOL_COSTS = {};\n");
  t.source("tools/index.test.ts", "// a test file: the build emits nothing for it\n");
  t.output("tools/index.js", "export const ALL_TOOLS = [];\n");
  t.output("credits/costs.js", "export const TOOL_COSTS = {};\n");
  return t;
}

// ---------------------------------------------------------------------------
// Constraint 1 — a STALE dist must be RED, with a reason a human can act on.
// This is the whole point of the slice: MEASURED before the fix, a tool description edited in
// apps/mcp/src and deliberately not rebuilt still produced "38 tool pages in sync", exit 0.
// ---------------------------------------------------------------------------

describe("stale dist is rejected", () => {
  it("fails when a source is newer than its compiled output", () => {
    const t = freshTree();
    t.source("tools/index.ts", "export const ALL_TOOLS = ['edited but not rebuilt'];\n", BASE + 60);

    expect(() => t.check()).toThrow(/is STALE/i);
  });

  it("names the offending file and the command that fixes it", () => {
    const t = freshTree();
    t.source("tools/index.ts", "export const ALL_TOOLS = ['edited'];\n", BASE + 60);

    let message = "";
    try {
      t.check();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/tools\/index\.ts/);
    expect(message).toMatch(/newer than their compiled output/i);
    expect(message).toMatch(/pnpm --filter @pseo\/mcp build/);
    // The message must say WHY a stale build matters, not merely that it is stale.
    expect(message).toMatch(/passes for the wrong reason/i);
  });

  it("fails when a source was never compiled at all (a module added and not built)", () => {
    const t = freshTree();
    t.source("tools/brand-new-tool.ts", "export const brandNewTool = {};\n");

    expect(() => t.check()).toThrow(/never compiled at all/i);
  });
});

// ---------------------------------------------------------------------------
// Constraint 2 — no dist at all must be an understandable error, never a silent pass.
// ---------------------------------------------------------------------------

describe("missing dist is rejected", () => {
  it("fails with a build instruction when the dist directory does not exist", () => {
    const t = tree();
    t.source("tools/index.ts", "export const ALL_TOOLS = [];\n");

    expect(() => assertDistFresh({ srcDir: t.src, distDir: join(t.root, "nope"), distLabel: "apps/mcp/dist" })).toThrow(
      /has no compiled output[\s\S]*pnpm --filter @pseo\/mcp build/i,
    );
  });

  it("fails when the dist directory exists but holds no compiled output", () => {
    const t = tree();
    t.source("tools/index.ts", "export const ALL_TOOLS = [];\n");

    expect(() => t.check()).toThrow(/no compiled output/i);
  });

  it("refuses to pass when the SOURCE tree is empty — an unmeasurable run is not a green", () => {
    // Guards the emptiest possible false green: a wrong srcDir finds nothing to compare, so every
    // per-file rule is vacuously satisfied and the check would otherwise report success.
    const t = tree();
    t.output("tools/index.js", "export const ALL_TOOLS = [];\n");

    expect(() => t.check()).toThrow(/no compiled TypeScript sources[\s\S]*refuses to report a pass/i);
  });
});

// ---------------------------------------------------------------------------
// Constraint 3 — no false positives. A real build must pass, and keep passing.
// ---------------------------------------------------------------------------

describe("fresh dist passes", () => {
  it("passes when every output is newer than its source", () => {
    const t = freshTree();

    expect(t.check()).toMatchObject({ rescued: false });
  });

  it("passes when an output shares its source's exact timestamp (a fast build)", () => {
    const t = tree();
    t.source("tools/index.ts", "export const ALL_TOOLS = [];\n", BASE);
    t.output("tools/index.js", "export const ALL_TOOLS = [];\n", BASE);

    expect(() => t.check()).not.toThrow();
  });

  it("does not demand a compiled output for *.test.ts (the build excludes them)", () => {
    const t = freshTree();
    // A test file newer than everything in dist: excluded from the build, so not evidence of drift.
    t.source("tools/index.test.ts", "// edited long after the build\n", BASE + 9999);

    expect(() => t.check()).not.toThrow();
  });

  it("reports WHAT it measured, so a green line can be audited (signed lesson 7)", () => {
    const t = freshTree();

    expect(t.check().measured).toMatch(/2 sources vs 2 compiled outputs/);
  });
});

// ---------------------------------------------------------------------------
// The fingerprint memo. MEASURED reason it exists: a turbo cache HIT replays the build without
// touching dist, so timestamps can look stale while the content is exactly what dist was built
// from — and `pnpm turbo run build` would not clear it. The memo forgives that case ON EVIDENCE.
// ---------------------------------------------------------------------------

describe("fingerprint memo", () => {
  it("is written next to the outputs when a run passes on timestamps", () => {
    const t = freshTree();
    t.check();

    expect(t.memo()).toMatchObject({ version: MEMO_VERSION });
    expect(t.memo().sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("forgives new timestamps when the source bytes are the ones already verified", () => {
    const t = freshTree();
    t.check(); // records (fingerprint, dist identity)

    // Same bytes, later mtime — a touch, a branch round-trip, or a revert.
    t.source("tools/index.ts", "export const ALL_TOOLS = [];\n", BASE + 500);

    expect(t.check()).toMatchObject({ rescued: true });
  });

  it("does NOT forgive when the bytes changed — the drift the gate exists for", () => {
    const t = freshTree();
    t.check();

    t.source("tools/index.ts", "export const ALL_TOOLS = ['drifted'];\n", BASE + 500);

    expect(() => t.check()).toThrow(/is STALE/i);
  });

  it("does NOT forgive when dist changed after the memo was recorded", () => {
    const t = freshTree();
    t.check();

    // A different build landed (one more output), so the recorded pairing no longer describes it.
    t.output("tools/extra.js", "export const extra = 1;\n", BASE + 20);
    t.source("tools/index.ts", "export const ALL_TOOLS = [];\n", BASE + 500);

    expect(() => t.check()).toThrow(/is STALE/i);
  });

  it("does NOT forgive a source that has no output, however familiar the fingerprint", () => {
    const t = freshTree();
    t.check();
    // Re-record with the new file present so a naive fingerprint match could not save it.
    t.source("tools/brand-new-tool.ts", "export const brandNewTool = {};\n", BASE);

    expect(() => t.check()).toThrow(/never compiled at all/i);
  });

  it("ignores a memo written by another version", () => {
    const t = freshTree();
    t.check();
    const stored = t.memo();
    writeFileSync(join(t.dist, MEMO_BASENAME), JSON.stringify({ ...stored, version: MEMO_VERSION + 1 }));
    t.source("tools/index.ts", "export const ALL_TOOLS = [];\n", BASE + 500);

    expect(() => t.check()).toThrow(/is STALE/i);
  });

  it("survives a corrupt memo by falling back to timestamps", () => {
    const t = freshTree();
    writeFileSync(join(t.dist, MEMO_BASENAME), "{ not json");

    expect(() => t.check()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("pure helpers", () => {
  it("maps a source path to the path tsc emits for it", () => {
    expect(outputRelFor("tools/list-projects.ts")).toBe("tools/list-projects.js");
    expect(outputRelFor("dfs/budget.ts")).toBe("dfs/budget.js");
  });

  it("counts only the sources the build actually emits", () => {
    expect(isCompiledSource("tools/index.ts")).toBe(true);
    expect(isCompiledSource("tools/index.test.ts")).toBe(false);
    expect(isCompiledSource("tools/index.db.test.ts")).toBe(false);
    expect(isCompiledSource("types/global.d.ts")).toBe(false);
    expect(isCompiledSource("tools/fixture.json")).toBe(false);
  });

  it("separates missing outputs from outdated ones", () => {
    const outputs = new Map([
      ["a.js", 100],
      ["b.js", 100],
    ]);
    const suspects = findSuspects(
      [
        { rel: "a.ts", mtimeMs: 50 },
        { rel: "b.ts", mtimeMs: 150 },
        { rel: "c.ts", mtimeMs: 50 },
      ],
      outputs,
    );

    expect(suspects).toEqual({ missing: ["c.ts"], newer: ["b.ts"] });
  });

  it("fingerprints content AND path, and does not depend on file order", () => {
    const one = [
      { rel: "a.ts", content: "x" },
      { rel: "b.ts", content: "y" },
    ];
    const reordered = [...one].reverse();

    expect(fingerprintSources(one)).toBe(fingerprintSources(reordered));
    // Renaming must change the fingerprint even though the bytes are identical…
    expect(fingerprintSources([{ rel: "a.ts", content: "x" }])).not.toBe(
      fingerprintSources([{ rel: "b.ts", content: "x" }]),
    );
    // …and a shift of the same characters across the path/content seam must not cancel out.
    expect(fingerprintSources([{ rel: "ab", content: "c" }])).not.toBe(
      fingerprintSources([{ rel: "a", content: "bc" }]),
    );
  });

  it("gives a dist a stamp that moves when the outputs move", () => {
    const before = new Map([["a.js", 100]]);
    expect(distStampOf(before)).toBe(distStampOf(new Map([["a.js", 100]])));
    expect(distStampOf(before)).not.toBe(distStampOf(new Map([["a.js", 200]])));
    expect(distStampOf(before)).not.toBe(
      distStampOf(
        new Map([
          ["a.js", 100],
          ["b.js", 100],
        ]),
      ),
    );
  });

  it("only rescues on an exact, current, same-version match", () => {
    const key = { sourceFingerprint: "abc", distStamp: "1:2" };
    expect(memoRescues({ version: MEMO_VERSION, ...key }, key)).toBe(true);
    expect(memoRescues({ version: MEMO_VERSION, sourceFingerprint: "other", distStamp: "1:2" }, key)).toBe(false);
    expect(memoRescues({ version: MEMO_VERSION, sourceFingerprint: "abc", distStamp: "9:9" }, key)).toBe(false);
    expect(memoRescues(null, key)).toBe(false);
    expect(memoRescues("not an object", key)).toBe(false);
  });

  it("summarises a long list instead of printing every path", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g"].map((n) => `tools/${n}.ts`);
    const message = renderStaleMessage({ newer: many, srcLabel: "src", distLabel: "dist" });

    expect(message).toMatch(/and 2 more/);
    expect(message).not.toMatch(/tools\/g\.ts/);
  });
});

// ---------------------------------------------------------------------------
// Wiring. The module above can be perfect and still measure nothing if the CLI never calls it —
// so the call, and its POSITION relative to the registry import, are pinned here.
// ---------------------------------------------------------------------------

describe("gen-tool-docs CLI wiring", () => {
  // Read from the vitest root (apps/web) rather than import.meta.url: vitest rewrites that to a
  // non-file URL, and the point here is to read the CLI as TEXT, not to import it.
  const cli = readFileSync(join(process.cwd(), "scripts", "gen-tool-docs.mjs"), "utf8");

  it("imports the freshness detector", () => {
    expect(cli).toMatch(/import\s*\{[^}]*assertDistFresh[^}]*\}\s*from\s*["']\.\/dist-freshness\.mjs["']/);
  });

  it("checks freshness BEFORE it loads the built registry", () => {
    const guard = cli.search(/assertDistFresh\s*\(/);
    const load = cli.search(/async function loadRegistry/);
    expect(guard).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);

    // Inside main(): the guard runs, and only then is the registry imported.
    const main = cli.slice(cli.indexOf("async function main("));
    const guardInMain = main.search(/assertRegistryFresh\s*\(/);
    const loadInMain = main.search(/await\s+loadRegistry\s*\(/);
    expect(guardInMain).toBeGreaterThan(-1);
    expect(loadInMain).toBeGreaterThan(-1);
    expect(guardInMain).toBeLessThan(loadInMain);
  });

  it("points the check at apps/mcp's real source and output trees", () => {
    expect(cli).toMatch(/srcDir:.*mcp\/src/);
    expect(cli).toMatch(/distDir:.*mcp\/dist/);
  });
});
