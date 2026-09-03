import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CTX, writeRun } from "../test/project-scope-pin.ts";
import { currentRecorder, resetRecorder } from "../test/ledger-recorder.ts";
import researchFixture from "../dfs/fixtures/keyword-overview.json";

/**
 * H-1, THE FAMILY SWEEP: every `charge:"handler"` tool either hands `withCredits` a project or is
 * named here as one that has none to hand.
 *
 * The per-tool pins beside this file each cover the tool they name. What none of them can see is
 * the tool NOBODY wrote a pin for — and that is the shape H-1 actually had: fifteen call sites, no
 * list anywhere, every one of them free to forget. So the roster comes from the REGISTRY
 * (`ALL_TOOLS`, filtered by `charge`), never from a list of names typed here: a sixteenth
 * self-settling tool lands in this spec the moment it is registered.
 *
 * The check reads SOURCE rather than running each tool, and that is the point — running them would
 * need a port, a fixture and an input per tool, which is exactly the per-tool work that already
 * exists. What is missing at the family level is cheap and structural: does the `withCredits` meta
 * at this tool's own call site mention `projectId` at all?
 *
 * =====================================================================================
 * B-1 (2026-09-03): IT READS THE ARGUMENT, NOT A WINDOW OF LINES
 * =====================================================================================
 * This check used to read the 8 CODE lines following the guard call and accept a `projectId`
 * anywhere in them. MEASURED, by the Dilim 4 referee: deleting `projectId` from
 * `ranked-keywords.ts`'s `const meta` left this sweep GREEN. The window had walked straight past
 * the meta — which is bound one line ABOVE the call — into the `writeRun(...)` arguments below it,
 * and a run row carries `tool:` and `projectId:` too. So the sweep answered about the RUN TABLE
 * while claiming to answer about the LEDGER, and it did that for exactly the defect it was
 * written to find. Only `rankings-project-scope.pin.test.ts` went red; the family check, whose
 * whole purpose is to see the tool nobody wrote a per-tool pin for, saw nothing.
 *
 * That is the same shape as the anchor bug recorded below, moved one axis over (signed lesson 14:
 * a hole closed on the QUOTE axis reopens on the POSITION axis). A window is a guess about
 * distance. So the distance is gone: the second argument of the `withCredits(...)` call is
 * extracted by BALANCED SCAN, and when it is an identifier the `const <name> = …` it refers to is
 * followed. Nothing is read that the guard is not actually handed, and a call site whose meta
 * cannot be resolved THROWS — a fallback to a wider search is the hole, not the missing match.
 */

const SOURCE_DIR = import.meta.dirname;

/** Tool name to module: the repo's one naming convention, `snake_case` -> `kebab-case.ts`. */
function sourceOf(tool: string): string {
  return readFileSync(`${SOURCE_DIR}/${tool.replaceAll("_", "-")}.ts`, "utf8");
}

/**
 * The same source with every COMMENT and every STRING body blanked to spaces, positions kept.
 *
 * Balanced scanning is only sound over code punctuation, and these call sites are full of prose:
 * two of them (serp_snapshot, ai_visibility_compare) carry a comment BETWEEN the arguments, and
 * the modules are dense with `(`, `{` and `,` inside sentences and inside message strings. Masking
 * rather than deleting keeps every index valid, so a span found here slices the REAL source.
 */
function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  const blank = (at: number): void => {
    if (source[at] !== "\n") out[at] = " ";
  };
  let i = 0;
  while (i < source.length) {
    const here = source[i];
    const next = source[i + 1];
    if (here === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") blank(i++);
      continue;
    }
    if (here === "/" && next === "*") {
      blank(i++);
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) blank(i++);
      if (i < source.length) {
        blank(i++);
        blank(i++);
      }
      continue;
    }
    if (here === '"' || here === "'" || here === "`") {
      i += 1; // the opening quote stays: it is not a bracket and cannot unbalance anything.
      while (i < source.length) {
        if (source[i] === "\\") {
          blank(i++);
          blank(i++);
          continue;
        }
        const closing = source[i] === here;
        blank(i++);
        if (closing) break;
      }
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Spans of the top-level arguments of the call whose `(` sits at `open`, in call order. */
function argumentSpans(masked: string, open: number): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        spans.push([start, i]);
        return spans;
      }
    } else if (char === "," && depth === 1) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  throw new Error("the withCredits call's argument list is never closed");
}

/**
 * The SOURCE OF THE OBJECT this tool actually hands `withCredits` as its `meta` — the second
 * argument, resolved through a `const` binding when that is what the argument names.
 *
 * Two shapes exist in the tree and both end at the same object: the meta written inline in the
 * argument list, or bound to a `const` immediately above the call. Anything else (a helper call, a
 * spread, a second binding layer) throws rather than being guessed at.
 */
function creditMetaSource(tool: string): string {
  const source = sourceOf(tool);
  const masked = maskCommentsAndStrings(source);
  const call = masked.indexOf("withCredits(");
  if (call === -1) throw new Error(`no withCredits call found in "${tool}"`);
  // A SECOND guard call would mean this check reads one of them and reports for both.
  if (masked.indexOf("withCredits(", call + 1) !== -1) {
    throw new Error(
      `"${tool}" has more than one withCredits call, so reading the first one would report ` +
        "about a call site nobody looked at",
    );
  }
  const spans = argumentSpans(masked, call + "withCredits".length);
  const meta = spans[1];
  if (!meta) throw new Error(`the withCredits call in "${tool}" has no meta argument`);
  // The SHAPE is decided on the masked text — two call sites put a comment between the arguments,
  // and the real slice still carries it — while every returned span slices the real source.
  const maskedArgument = masked.slice(meta[0], meta[1]);
  const expression = maskedArgument.trim();
  if (expression.startsWith("{")) {
    const at = meta[0] + maskedArgument.indexOf("{");
    const [, close] = argumentSpans(masked, at).at(-1) as readonly [number, number];
    return source.slice(at, close + 1);
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(expression)) {
    throw new Error(
      `the credit meta of "${tool}" is neither an object literal nor a plain binding name ` +
        `(saw \`${expression}\`) — resolving it would be a guess`,
    );
  }
  const binding = new RegExp(`\\bconst\\s+${expression}\\b[^=]*=`).exec(masked);
  if (!binding) {
    throw new Error(`the credit meta of "${tool}" names \`${expression}\`, which is not bound here`);
  }
  const initializer = binding.index + binding[0].length;
  const brace = masked.indexOf("{", initializer);
  if (brace === -1) throw new Error(`the credit meta binding of "${tool}" is not an object`);
  const [, end] = argumentSpans(masked, brace).at(-1) as readonly [number, number];
  return source.slice(brace, end + 1);
}

/**
 * The resolved meta, PROVEN to be this tool's own before anything is concluded from it.
 *
 * Without this the check could resolve some other object and report about it — which is precisely
 * the failure that produced B-1 and the anchor bug before it. A meta that does not name this tool
 * is a parse that went wrong, and it fails loudly instead of answering.
 */
function checkedMetaSource(tool: string): string {
  const meta = creditMetaSource(tool);
  if (!meta.includes(`tool: "${tool}"`)) {
    throw new Error(
      `the object read as "${tool}"'s credit meta does not name it (\`tool: "${tool}"\` is not ` +
        `in it) — the resolution is wrong, and a wrong one that answers is worse than none:\n${meta}`,
    );
  }
  return meta;
}

function namesProjectScope(tool: string): boolean {
  return checkedMetaSource(tool).includes("projectId");
}

/**
 * The tools with NO project to name — each with the reason, because an exemption without one is
 * indistinguishable from an oversight. Both take a subject that is not a site at all, and
 * credits/guard.ts is explicit that undefined is a real answer rather than a missing one.
 */
const NO_SUBJECT_TO_SCOPE: Readonly<Record<string, string>> = {
  audit_speed: "takes page URLs and nothing else — no target, no project_id",
  research_keywords: "takes a keyword set and nothing else — no target, no project_id",
};

vi.mock("../db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db.ts")>()),
  getServiceClient: () => currentRecorder().client,
}));

const { ALL_TOOLS } = await import("./index.ts");
const { makeResearchKeywordsTool } = await import("./research-keywords.ts");
const { createMockResearchPort } = await import("../dfs/client.ts");

const SELF_SETTLING = ALL_TOOLS.filter((tool) => tool.charge === "handler").map(
  (tool) => tool.name,
);

describe("every charge:\"handler\" tool accounts for its ledger project scope (H-1)", () => {
  it("finds the family at all — the roster is the registry's, not a list typed here", () => {
    expect(SELF_SETTLING.length).toBeGreaterThan(10);
    for (const tool of Object.keys(NO_SUBJECT_TO_SCOPE)) {
      expect(SELF_SETTLING).toContain(tool);
    }
  });

  /**
   * THE CHECK'S OWN READING, MEASURED — because a sweep that reads the wrong object answers
   * confidently and is never questioned (signed lesson 11).
   *
   * `ranked_keywords` is the tool B-1 was found on and it is the hard case in both directions:
   * its meta is BOUND above the call, and the `writeRun(...)` below the call carries a `tool:` key
   * and a `projectId:` of its own. The line-window check read that write and reported green while
   * the ledger meta was blank. So the resolution is asserted both ways round: what it MUST see,
   * and the neighbouring object it must NOT have wandered into.
   */
  it("resolves the LEDGER meta and not the run-row write beside it (B-1)", () => {
    const meta = checkedMetaSource("ranked_keywords");
    expect(meta).toContain("projectId: subject.project?.id");
    // `target:` and `userId:` are writeRun's own keys, and `??` is how it spells its fallback.
    // Any of them in here means the scan left the guard's argument.
    for (const foreign of ["target:", "userId:", "??"]) {
      expect(meta, `resolved meta ran into the run-row write: ${meta}`).not.toContain(foreign);
    }
    // The other shape, resolved by the same code: an object literal written inline as the
    // argument, several lines below the call and with a comment between the two.
    expect(checkedMetaSource("serp_snapshot")).toContain("projectId: subject.project?.id");
  });

  it("names a project at every call site that has one to name", () => {
    const missing = SELF_SETTLING.filter(
      (tool) => !(tool in NO_SUBJECT_TO_SCOPE) && !namesProjectScope(tool),
    );
    // keyword_positions landed in fix/positions-d3 (merged after fix/ledger-scope-d3), so the
    // roster is complete: every charge:"handler" tool with a subject scopes its ledger row.
    expect(missing).toEqual([]);
  });

  it("leaves the exempt tools genuinely without one, rather than quietly scoped", () => {
    for (const tool of Object.keys(NO_SUBJECT_TO_SCOPE)) {
      expect(namesProjectScope(tool)).toBe(false);
    }
  });

  /**
   * The exemption, MEASURED rather than asserted in prose: research_keywords really does reserve,
   * and the reserve it opens really does carry a null scope. audit_speed's own half of this claim
   * is audit-speed-charge.pin.test.ts's and it keeps it.
   */
  it("research_keywords reserves with no project scope, because it has no site to name", async () => {
    resetRecorder();
    const tool = makeResearchKeywordsTool({
      port: createMockResearchPort(researchFixture),
      writeRun,
    });
    try {
      await tool.run(CTX, { keywords: ["seo software"] });
    } catch {
      // deliberate — a throw is what makes withCredits RELEASE; the reserve is what is read.
    }
    const reserve = currentRecorder().reserve();
    expect(reserve?.args.p_tool).toBe("research_keywords");
    expect(reserve?.args.p_project_id).toBeNull();
  });
});
