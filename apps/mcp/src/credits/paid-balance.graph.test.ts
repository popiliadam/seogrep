import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PAID_BALANCE_TOOLS } from "./paid-balance.ts";
import { TOOL_COSTS, type ToolName } from "./costs.ts";
import { ALL_TOOLS, type RegisteredTool } from "../tools/index.ts";

/**
 * The vendor-money gate, checked STRUCTURALLY instead of by memory.
 *
 * THE HOLE THIS CLOSES. PAID_BALANCE_TOOLS is a hand-written allowlist and paid-balance.test.ts
 * pins its exact membership — but that pin only catches a name ADDED to or REMOVED from the SET.
 * It cannot catch the direction that actually costs money: a FIFTH DataForSEO tool written and
 * never added. The set would still hold exactly the four names, the membership pin would still be
 * green, and a trial account would be spending real DataForSEO money the day that tool shipped —
 * the denial-of-service against paying customers the gate exists to prevent (paid-balance.ts).
 *
 * WHAT IS MEASURED INSTEAD. The vendor-spending surface is not a list of names: it is the set of
 * `reserveSpend()` call sites (dfs/budget.ts), which is what books money against the DataForSEO
 * day. The rule is therefore derived from the IMPORT GRAPH — any tool module that reaches a
 * module importing `reserveSpend`, directly or through any chain, must be gated.
 *
 * HOW IT IS PROVEN TO BITE. The scanner is a pure function over a path -> source map, so a
 * SYNTHETIC fifth tool is fed to it in-process and shown to be flagged — the device the pricing
 * page's M-26 rule uses, where the assertion is exercised against a synthetic cost table rather
 * than trusted. The real tree is then scanned by that same function. (A runtime probe was
 * rejected: it would have to CALL the tools, i.e. a DataForSEO request — NEVER #5 — or a mock,
 * and a mock that never reaches reserveSpend is exactly the tool the gate would miss.)
 */

const SRC_DIR = resolve(import.meta.dirname, "..");
const TOOLS_DIR = join(SRC_DIR, "tools");

/**
 * The identifier that books vendor money. A module importing it can spend; a module importing
 * THAT module can spend through it. Matched in the import CLAUSE, never anywhere in the file, so
 * budget.ts — which DEFINES it and spends nothing itself — is not a seed.
 */
const SPEND_IMPORT = "reserveSpend";

/**
 * Every relative `import`/`export … from` in a source file, with its clause. `[\s\S]*?` so a
 * multi-line clause (every DataForSEO adapter has one) is captured whole rather than at its
 * first newline.
 */
const EDGE_RE = /(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["'](\.[^"']*)["']/g;

interface Edge {
  readonly target: string;
  /** `import type … from` — erased at build time, so it carries no code and no spend. */
  readonly typeOnly: boolean;
  readonly spends: boolean;
}

function edgesOf(file: string, source: string): Edge[] {
  const edges: Edge[] = [];
  for (const match of source.matchAll(EDGE_RE)) {
    const typeOnly = Boolean(match[1]);
    const clause = match[2] ?? "";
    const specifier = match[3] ?? "";
    edges.push({
      target: resolve(dirname(file), specifier),
      typeOnly,
      // An inline `{ type X, reserveSpend }` still counts — the clause carries a value binding.
      spends: !typeOnly && new RegExp(`\\b${SPEND_IMPORT}\\b`).test(clause),
    });
  }
  return edges;
}

/**
 * Every file in `sources` that can reach a vendor-spend call, directly or transitively.
 * Pure: `sources` is a path -> source map, so the real tree and a synthetic one are scanned by
 * exactly the same code. Cycles terminate (a file already on the stack contributes nothing).
 */
function filesThatCanSpend(sources: ReadonlyMap<string, string>): ReadonlySet<string> {
  const graph = new Map<string, Edge[]>();
  for (const [file, source] of sources) graph.set(file, edgesOf(file, source));

  const memo = new Map<string, boolean>();
  const reaches = (file: string, stack: Set<string>): boolean => {
    const cached = memo.get(file);
    if (cached !== undefined) return cached;
    if (stack.has(file)) return false;
    stack.add(file);
    let spends = false;
    for (const edge of graph.get(file) ?? []) {
      // A type-only edge is erased by the compiler: it can carry neither a call nor a chain to
      // one, so it is not traversed. (Over-flagging on it would be the "safe" direction only in
      // appearance — it would demand a paid-balance gate on a tool that spends nothing, and a
      // gate nobody believes is a gate nobody keeps.)
      if (edge.typeOnly) continue;
      // A direct `reserveSpend` import makes THIS file a spender; otherwise inherit from the edge.
      if (edge.spends || reaches(edge.target, stack)) {
        spends = true;
        break;
      }
    }
    stack.delete(file);
    memo.set(file, spends);
    return spends;
  };

  return new Set([...sources.keys()].filter((file) => reaches(file, new Set())));
}

/** Every non-test `.ts` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.includes(".test.") ? [path] : [];
  });
}

function readSources(files: readonly string[]): ReadonlyMap<string, string> {
  return new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
}

/** The RegisteredTool values a module exports (factories are functions and are skipped). */
function registeredToolsIn(module: Record<string, unknown>): RegisteredTool[] {
  return Object.values(module).filter(
    (value): value is RegisteredTool =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as RegisteredTool).name === "string" &&
      typeof (value as RegisteredTool).run === "function" &&
      (value as RegisteredTool).name in TOOL_COSTS,
  );
}

async function toolNamesDefinedIn(file: string): Promise<ToolName[]> {
  const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  return registeredToolsIn(module).map((tool) => tool.name);
}

/** Tool modules only: the barrel re-exports every tool and would claim to define them all. */
const TOOL_MODULES = sourceFiles(TOOLS_DIR).filter((file) => file !== join(TOOLS_DIR, "index.ts"));

/**
 * The rule proven on a SYNTHETIC tree before it is trusted on the real one — the failure this
 * whole file exists for, staged deliberately: a fifth tool that spends through a CHAIN and is
 * not in the allowlist, beside the three shapes that must NOT be flagged.
 */
const SYNTHETIC: ReadonlyMap<string, string> = new Map([
  ["/s/dfs/budget.ts", "export async function reserveSpend() {}"],
  [
    "/s/dfs/new-endpoint.ts",
    'import { reserveSpend, type SpendLedger } from "./budget.ts";\nexport const p = reserveSpend;',
  ],
  // One hop away from the spender — the indirection a name-based allowlist misses.
  ["/s/dfs/shared.ts", 'import { p } from "./new-endpoint.ts";\nexport const q = p;'],
  ["/s/tools/new-dfs-tool.ts", 'import { q } from "../dfs/shared.ts";\nexport const t = q;'],
  ["/s/tools/free-tool.ts", 'import { z } from "zod";\nexport const f = z;'],
  [
    "/s/tools/types-only.ts",
    'import type { SpendLedger } from "../dfs/new-endpoint.ts";\nexport type T = SpendLedger;',
  ],
]);

describe("the vendor-spend scanner", () => {
  const spenders = () => filesThatCanSpend(SYNTHETIC);

  it("flags a tool that reaches reserveSpend through a CHAIN, not just a direct import", () => {
    expect(spenders().has("/s/tools/new-dfs-tool.ts")).toBe(true);
    expect(spenders().has("/s/dfs/shared.ts")).toBe(true);
    expect(spenders().has("/s/dfs/new-endpoint.ts")).toBe(true);
  });

  it("does NOT flag a tool that never reaches it", () => {
    expect(spenders().has("/s/tools/free-tool.ts")).toBe(false);
  });

  it("does NOT flag a type-only reach (no code moves, no money moves)", () => {
    expect(spenders().has("/s/tools/types-only.ts")).toBe(false);
  });

  it("does NOT flag budget.ts itself — defining reserveSpend is not spending", () => {
    expect(spenders().has("/s/dfs/budget.ts")).toBe(false);
  });
});

describe("every tool that can spend vendor money is behind the paid-balance gate", () => {
  it("finds the real DataForSEO tool modules (a scanner that finds nothing proves nothing)", () => {
    const spenders = filesThatCanSpend(readSources(sourceFiles(SRC_DIR)));
    const spendingToolModules = TOOL_MODULES.filter((file) => spenders.has(file)).map((file) =>
      relative(SRC_DIR, file),
    );
    expect(spendingToolModules.sort()).toEqual([
      "tools/analyze-backlinks.ts",
      // audit_speed (2026-08-17): the first vendor-spending tool whose name puts it in the audit
      // family. It reaches reserveSpend through dfs/lighthouse.ts, so the scanner finds it here
      // exactly as it would a fifth `dfs_*`-shaped tool — which is the point of deriving the rule
      // from the import graph instead of from what a name looks like.
      "tools/audit-speed.ts",
      // backlink_changes (2026-08-18): reaches reserveSpend through dfs/backlink-changes.ts.
      "tools/backlink-changes.ts",
      // backlink_details (2026-08-18): reaches reserveSpend through dfs/backlink-details.ts.
      "tools/backlink-details.ts",
      "tools/compare-competitors.ts",
      // disavow_candidates (2026-08-19): reaches reserveSpend through dfs/disavow-candidates.ts.
      "tools/disavow-candidates.ts",
      // discover_keywords (2026-08-19): reaches reserveSpend through dfs/discover-keywords.ts.
      "tools/discover-keywords.ts",
      "tools/keyword-gap.ts",
      "tools/link-gap.ts",
      // my_pages (2026-08-19), TWO entries for ONE tool, and the second is the interesting one.
      // tools/my-pages-crawl.ts defines no tool at all — it is the crawl-side join, and it reaches
      // reserveSpend only because it imports `pageJoinKey` from dfs/relevant-pages.ts, which is
      // deliberate: both sides of the join must normalise with the SAME function. The scanner is
      // reachability, not intent, so it flags the file and the list says so rather than the file
      // being moved out of tools/ to keep this list tidy. The spec below is what actually matters
      // for money — it asks which TOOL NAMES these modules define, and this one defines none.
      "tools/my-pages-crawl.ts",
      "tools/my-pages.ts",
      "tools/ranked-keywords.ts",
      "tools/research-keywords.ts",
    ]);
  });

  it("gates every tool name those modules define", async () => {
    const spenders = filesThatCanSpend(readSources(sourceFiles(SRC_DIR)));
    const spendingTools = (
      await Promise.all(TOOL_MODULES.filter((file) => spenders.has(file)).map(toolNamesDefinedIn))
    ).flat();

    expect(spendingTools.length).toBeGreaterThan(0);
    for (const tool of spendingTools) {
      expect(
        PAID_BALANCE_TOOLS.has(tool),
        `${tool} reaches reserveSpend but is not in PAID_BALANCE_TOOLS — a trial account could ` +
          `spend real DataForSEO money with it`,
      ).toBe(true);
    }
  });

  /**
   * The scan is scoped to src/tools, so that scoping is itself checked rather than assumed: if a
   * tool were ever defined outside that directory it would sit outside the rule entirely, and the
   * gate would go quiet without anything failing.
   */
  it("…and no registered tool is defined outside the scanned directory", async () => {
    const defined = new Set((await Promise.all(TOOL_MODULES.map(toolNamesDefinedIn))).flat());
    for (const tool of ALL_TOOLS) {
      expect(defined.has(tool.name), `${tool.name} is not defined under src/tools`).toBe(true);
    }
  });
});
